import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { createApp, defineRoutes, endpoint, type Middleware } from "../src/index.ts";
import { selfHeal, type SelfHealOptions } from "../src/self-heal.ts";
import { clearHealSources, healSnapshots } from "../src/self-heal-state.ts";
import { chaos } from "../src/chaos.ts";
import { metricsHandler } from "../src/metrics.ts";
import { problemDetails } from "../src/problem.ts";
import { devtools } from "../src/dev/index.ts";
import { dashboardOf } from "../src/dev/registry.ts";
import { explainText } from "../src/dev/explain.ts";
import { errorCode } from "../src/errors.ts";
import { isPlainSafe } from "../src/plain.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

// 時計はテストが進める(Date.now() を使うので setSystemTime が効く)
let now = 0;
const advance = (ms: number) => setSystemTime(new Date((now += ms)));

const env = { NODE_ENV: process.env.NODE_ENV, LC_ALL: process.env.LC_ALL };
beforeEach(() => {
    process.env.LC_ALL = "ja_JP.UTF-8";
    now = Date.UTC(2026, 0, 1);
    setSystemTime(new Date(now));
    clearHealSources();
});
afterEach(() => {
    setSystemTime();
    for (const [name, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
});

// mode で /users/:id の振る舞いを変える
type Mode = "ok" | "fail" | "throw" | "slow" | "notFound";
function makeApp(options: Omit<SelfHealOptions, "log"> = {}) {
    const lines: string[] = [];
    const state = { mode: "ok" as Mode, calls: 0 };
    const app = createApp();
    app.use(selfHeal({ ...options, log: (line) => lines.push(line) }));
    app.get("/users/:id", (_, c) => {
        state.calls++;
        if (state.mode === "fail") return c.text("down", 503);
        if (state.mode === "throw") throw new Error("boom");
        if (state.mode === "notFound") return c.text("no", 404);
        if (state.mode === "slow") advance(3000);
        return "ok";
    });
    app.get("/other", () => "other");
    return { app, lines, state };
}

async function hit(app: ReturnType<typeof createApp>, n: number, path = "/users/1"): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await app.fetch(req(path))).status);
    return out;
}

// 止まるまで失敗させる
async function trip(t: ReturnType<typeof makeApp>) {
    t.state.mode = "fail";
    await hit(t.app, 10);
    expect((await t.app.fetch(req("/users/1"))).status).toBe(503);
}

describe("selfHeal(): 止める条件", () => {
    test("30 秒で 10 件以上あり、半分以上が失敗したら止める。9 件では止めない", async () => {
        const { app, lines, state } = makeApp();
        state.mode = "fail";
        await hit(app, 9);
        expect(lines).toEqual([]);
        await hit(app, 1);
        expect(lines).toEqual(["[senri] self-heal: GET /users/:id を止めた(直近 30 秒で 10 件中 10 件失敗)。10 秒後に 1 件だけ通して様子を見ます"]);

        // 止めているあいだは、ハンドラーまで届かない
        const calls = state.calls;
        const res = await app.fetch(req("/users/2"));
        expect(res.status).toBe(503);
        expect(res.headers.get("retry-after")).toBe("10");
        expect(await res.text()).toBe("This route is paused after repeated failures. Try again later.");
        expect(state.calls).toBe(calls);
    });

    test("回数ではなく割合で決める(リクエストが多いルートは、少しの失敗では止まらない)", async () => {
        const { app, lines, state } = makeApp();
        await hit(app, 20);
        state.mode = "fail";
        // 20 件成功のあと、19 件失敗(39 件中 19 件 < 半分)では止まらない
        await hit(app, 19);
        expect(lines).toEqual([]);
        await hit(app, 1);
        expect(lines.at(-1)).toContain("直近 30 秒で 40 件中 20 件失敗");
    });

    test("窓より古い失敗は数えない", async () => {
        const { app, lines, state } = makeApp();
        state.mode = "fail";
        await hit(app, 9);
        advance(31_000);
        await hit(app, 9);
        expect(lines).toEqual([]);
    });

    test("window・minRequests・threshold を変えられる", async () => {
        const { app, lines, state } = makeApp({ window: "5s", minRequests: 3, threshold: 1 });
        state.mode = "fail";
        await hit(app, 2);
        state.mode = "ok";
        await hit(app, 1);
        state.mode = "fail";
        // 4 件中 3 件の失敗では、threshold: 1 に届かない
        await hit(app, 1);
        expect(lines).toEqual([]);
        advance(6000);
        await hit(app, 3);
        expect(lines.at(-1)).toContain("直近 5 秒で 3 件中 3 件失敗");
    });

    test("例外(onError で 500 になる)と、自分で返した 5xx は失敗。4xx は数えない", async () => {
        const thrown = makeApp();
        thrown.state.mode = "throw";
        await hit(thrown.app, 10);
        expect(thrown.lines).toHaveLength(1);

        const notFound = makeApp();
        notFound.state.mode = "notFound";
        await hit(notFound.app, 20);
        expect(notFound.lines).toEqual([]);
    });

    test("slow を指定したときだけ、遅すぎる応答を失敗として数える", async () => {
        const without = makeApp();
        without.state.mode = "slow";
        await hit(without.app, 10);
        expect(without.lines).toEqual([]);

        const withSlow = makeApp({ slow: "2s" });
        withSlow.state.mode = "slow";
        await hit(withSlow.app, 10);
        expect(withSlow.lines).toHaveLength(1);
    });

    test("ルートの形で数える。/users/:id が止まっても、ほかのルートは動く", async () => {
        const { app, lines, state } = makeApp();
        state.mode = "fail";
        for (let i = 0; i < 10; i++) await app.fetch(req(`/users/${i}`));
        expect(lines.at(-1)).toContain("GET /users/:id を止めた");
        expect((await app.fetch(req("/users/999"))).status).toBe(503);
        expect(await hit(app, 3, "/other")).toEqual([200, 200, 200]);
    });

    test("HEAD は GET と一緒に数える", async () => {
        const { app, state } = makeApp();
        state.mode = "fail";
        for (let i = 0; i < 10; i++) await app.fetch(req("/users/1", { method: i % 2 ? "HEAD" : "GET" }));
        expect((await app.fetch(req("/users/1", { method: "HEAD" }))).status).toBe(503);
        expect((await app.fetch(req("/users/1"))).status).toBe(503);
    });

    test("どのルートにも当たらないリクエスト(404)は数えない", async () => {
        const { app } = makeApp();
        await hit(app, 20, "/nope");
        expect([...healSnapshots().keys()]).toEqual([]);
    });
});

describe("selfHeal(): 戻し方", () => {
    test("止めてから 10 秒たったら 1 件だけ通す。成功したら戻す", async () => {
        const t = makeApp();
        await trip(t);
        advance(5000);
        const waiting = await t.app.fetch(req("/users/1"));
        expect([waiting.status, waiting.headers.get("retry-after")]).toEqual([503, "5"]);

        advance(5000);
        t.state.mode = "ok";
        expect(await hit(t.app, 2)).toEqual([200, 200]);
        expect(t.lines.slice(1)).toEqual(["[senri] self-heal: GET /users/:id の様子を見る(1 件だけ通す)", "[senri] self-heal: GET /users/:id を戻した(様子見の 1 件が成功した)"]);
    });

    test("様子見の 1 件が失敗したら、また 10 秒待つ", async () => {
        const t = makeApp();
        await trip(t);
        advance(10_000);
        const probe = await t.app.fetch(req("/users/1"));
        expect(probe.status).toBe(503);
        expect(t.lines.at(-1)).toBe("[senri] self-heal: GET /users/:id はまだ失敗するので、止めたままにする。10 秒後にまた 1 件だけ通します");
        const res = await t.app.fetch(req("/users/1"));
        expect([res.status, res.headers.get("retry-after")]).toEqual([503, "10"]);
    });

    test("様子見のあいだに来たほかのリクエストは、503 で返す", async () => {
        const lines: string[] = [];
        let release: (() => void) | undefined;
        let failing = true;
        const app = createApp();
        app.use(selfHeal({ log: (line) => lines.push(line) }));
        app.get("/x", async (_, c) => {
            if (failing) return c.text("down", 500);
            await new Promise<void>((resolve) => (release = resolve));
            return "ok";
        });
        await hit(app, 10, "/x");
        advance(10_000);
        failing = false;
        const probe = app.fetch(req("/x"));
        await Bun.sleep(0);
        expect((await app.fetch(req("/x"))).status).toBe(503);
        release!();
        expect((await probe).status).toBe(200);
        expect(lines.at(-1)).toContain("を戻した");
    });

    test("様子見の 1 件が返ってこなければ、もう 10 秒たったら次の 1 件を通す(前の結果は使わない)", async () => {
        const lines: string[] = [];
        let mode: "fail" | "hang" | "ok" = "fail";
        let release: (() => void) | undefined;
        const app = createApp();
        app.use(selfHeal({ log: (line) => lines.push(line) }));
        app.get("/x", async (_, c) => {
            if (mode === "fail") return c.text("down", 500);
            if (mode === "hang") {
                await new Promise<void>((resolve) => (release = resolve));
                return c.text("late", 500);
            }
            return "ok";
        });
        await hit(app, 10, "/x");
        advance(10_000);
        mode = "hang";
        const stuck = app.fetch(req("/x"));
        await Bun.sleep(0);
        advance(9_000);
        expect((await app.fetch(req("/x"))).status).toBe(503);
        advance(1_000);
        mode = "ok";
        expect((await app.fetch(req("/x"))).status).toBe(200);
        expect(lines.at(-1)).toContain("を戻した");
        // 遅れて返ってきた前の 1 件(500)は数えない
        release!();
        await stuck;
        expect(await hit(app, 3, "/x")).toEqual([200, 200, 200]);
        expect(lines.at(-1)).toContain("を戻した");
    });

    test("自分が返した 503 は数えない(止めている間に何件来ても、戻ったあとに引きずらない)", async () => {
        const t = makeApp();
        await trip(t);
        expect(await hit(t.app, 50)).toEqual(new Array(50).fill(503));
        advance(10_000);
        t.state.mode = "ok";
        await hit(t.app, 1);
        // 戻ったあと、失敗 1 件では止まらない(数えなおし)
        t.state.mode = "fail";
        await hit(t.app, 1);
        t.state.mode = "ok";
        expect(await hit(t.app, 5)).toEqual([200, 200, 200, 200, 200]);
    });

    test("止める前に始まったリクエストの結果は、止めたあとには数えない", async () => {
        const lines: string[] = [];
        let release: (() => void) | undefined;
        const app = createApp();
        app.use(selfHeal({ log: (line) => lines.push(line) }));
        let slowOne = true;
        app.get("/x", async (_, c) => {
            if (slowOne) {
                slowOne = false;
                await new Promise<void>((resolve) => (release = resolve));
            }
            return c.text("down", 500);
        });
        const inFlight = app.fetch(req("/x"));
        await Bun.sleep(0);
        await hit(app, 10, "/x");
        expect(lines).toHaveLength(1);
        advance(10_000);
        // 遅れて返ってきた 500 で、様子見を飛ばして止め直したりしない
        release!();
        await inFlight;
        expect(lines).toHaveLength(1);
    });
});

describe("selfHeal(): 503 の応答", () => {
    test("ProblemError を投げるので、problemDetails() なら Problem Details で返す", async () => {
        const app = createApp();
        const { onError } = problemDetails();
        app.onError(onError);
        app.use(selfHeal({ log: () => {} }));
        app.get("/x", (_, c) => c.text("down", 500));
        await hit(app, 10, "/x");
        const res = await app.fetch(req("/x"));
        expect(res.status).toBe(503);
        expect(res.headers.get("content-type")).toBe("application/problem+json");
        expect(res.headers.get("retry-after")).toBe("10");
        expect(await res.json()).toEqual({
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
            detail: "This route is paused after repeated failures. Try again later.",
        });
    });

    test("Retry-After は残りの秒数の切り上げで、1 秒より短くしない", async () => {
        const t = makeApp({ cooldown: 2500 });
        await trip(t);
        advance(1);
        expect((await t.app.fetch(req("/users/1"))).headers.get("retry-after")).toBe("3");
        advance(2400);
        expect((await t.app.fetch(req("/users/1"))).headers.get("retry-after")).toBe("1");
    });
});

describe("selfHeal(): 2 つ重ねたとき", () => {
    test("いちばん内側が受け持ち、外側は数えない", async () => {
        const outer: string[] = [];
        const inner: string[] = [];
        const app = createApp();
        app.use(selfHeal({ log: (line) => outer.push(line) }));
        app.use("/x", selfHeal({ minRequests: 1000, log: (line) => inner.push(line) }));
        app.get("/x", (_, c) => c.text("down", 500));
        // 外側だけなら 10 件で止まるが、内側(minRequests: 1000)が受け持つので止まらない
        expect(await hit(app, 30, "/x")).toEqual(new Array(30).fill(500));
        expect([outer, inner]).toEqual([[], []]);
    });

    test("内側が返した 503 を、外側は失敗として数えない", async () => {
        const outer: string[] = [];
        let failing = true;
        const app = createApp();
        app.use(selfHeal({ log: (line) => outer.push(line) }));
        app.get("/x", { use: [selfHeal({ minRequests: 2, log: () => {} })] }, (_, c) => (failing ? c.text("down", 500) : "ok"));
        await hit(app, 2, "/x");
        expect(await hit(app, 30, "/x")).toEqual(new Array(30).fill(503));
        advance(10_000);
        failing = false;
        expect(await hit(app, 3, "/x")).toEqual([200, 200, 200]);
        expect(outer).toEqual([]);
    });

    test("内側に届く前に失敗したリクエストは、外側が数える", async () => {
        const outer: string[] = [];
        const app = createApp();
        app.use(selfHeal({ log: (line) => outer.push(line) }));
        const broken: Middleware = () => {
            throw new Error("before the inner one");
        };
        app.use("/x", broken);
        app.use("/x", selfHeal({ log: () => {} }));
        app.get("/x", () => "ok");
        await hit(app, 10, "/x");
        expect(outer).toHaveLength(1);
    });
});

describe("selfHeal(): 正直に見せる", () => {
    test("Prometheus のメトリクスに、ルートの状態・切り替わった回数・止めて返した数を出す", async () => {
        // 使っていなければ、メトリクスは増えない
        const plain = createApp();
        plain.get("/metrics", metricsHandler());
        expect(await (await plain.fetch(req("/metrics"))).text()).not.toContain("senri_self_heal");

        const t = makeApp();
        t.app.get("/metrics", metricsHandler());

        await trip(t);
        await hit(t.app, 2);
        const text = await (await t.app.fetch(req("/metrics"))).text();
        const lines = text.split("\n").filter((line) => line.startsWith("senri_self_heal"));
        expect(lines.sort()).toEqual([
            'senri_self_heal_state{method="GET",route="/users/:id"} 1',
            'senri_self_heal_transitions_total{method="GET",route="/users/:id",to="open"} 1',
            'senri_self_heal_transitions_total{method="GET",route="/users/:id",to="half_open"} 0',
            'senri_self_heal_transitions_total{method="GET",route="/users/:id",to="closed"} 0',
            'senri_self_heal_rejected_total{method="GET",route="/users/:id"} 3',
            // /metrics 自身も見ている(このあとの 1 回目の /metrics で増えたもの)
            'senri_self_heal_state{method="GET",route="/metrics"} 0',
            'senri_self_heal_transitions_total{method="GET",route="/metrics",to="open"} 0',
            'senri_self_heal_transitions_total{method="GET",route="/metrics",to="half_open"} 0',
            'senri_self_heal_transitions_total{method="GET",route="/metrics",to="closed"} 0',
            'senri_self_heal_rejected_total{method="GET",route="/metrics"} 0',
        ].sort());
        expect(text).toContain("# TYPE senri_self_heal_state gauge");
        expect(text).toContain("# TYPE senri_self_heal_transitions_total counter");
    });

    test("/_senri: ルートのタブに状態、止めて返したリクエストには何をしたかが残る", async () => {
        process.env.NODE_ENV = "development";
        const app = createApp({ dev: devtools() });
        app.use(selfHeal({ log: () => {} }));
        let failing = true;
        app.get("/x", (_, c) => (failing ? c.text("down", 500) : "ok"));
        app.get("/y", () => "y");
        await hit(app, 10, "/x");
        await app.fetch(req("/x", { headers: { "accept-language": "ja" } }));
        // ダッシュボードは localhost からのアクセスだけ(Bun の server を真似る)
        const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
        const routes = async () => (await (await app.fetch(req("/_senri/api/routes", { headers: { host: "localhost" } }), local)).json()) as { method: string; path: string; heal: string | null }[];
        expect((await routes()).map((r) => [r.path, r.heal])).toEqual([
            ["/x", "open"],
            ["/y", null],
        ]);

        const records = (await dashboardOf(app))!.log.list();
        expect(records[0]!.notes).toEqual([{ layer: "selfHeal", tag: "セルフヒール", text: "GET /x を止めているので 503 を返した(Retry-After: 10 秒)" }]);
        expect(records[0]!.layers[0]!.name).toBe("selfHeal");

        advance(10_000);
        failing = false;
        await app.fetch(req("/x", { headers: { "accept-language": "en" } }));
        expect((await dashboardOf(app))!.log.list()[0]!.notes).toEqual([{ layer: "selfHeal", tag: "self-heal", text: "let this request through as the probe of GET /x" }]);
        expect((await routes()).map((r) => r.heal)).toEqual(["closed", null]);
    });

    test("Cloudflare Workers では、ほぼ効かないことを起動時に警告する", () => {
        const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        const lines: string[] = [];
        try {
            Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
            selfHeal({ log: (line) => lines.push(line) });
        } finally {
            if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
        }
        expect(lines).toEqual(["[senri] selfHeal() の状態はインスタンスごとです。Cloudflare Workers ではインスタンスがすぐ入れ替わるため、ほぼ効きません"]);
    });

    test("Workers 以外では、起動時に何も出さない。既定の出力先は console.warn", async () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            const app = createApp();
            app.use(selfHeal());
            app.get("/x", (_, c) => c.text("down", 500));
            expect(warn).not.toHaveBeenCalled();
            await hit(app, 10, "/x");
            expect(warn.mock.calls[0]?.[0]).toContain("GET /x を止めた");
        } finally {
            warn.mockRestore();
        }
    });
});

describe("selfHeal(): カオスと組み合わせる", () => {
    test("X-Senri-Chaos: status=503 で壊すと止まり、壊すのをやめると勝手に戻る。横のルートはずっと動く", async () => {
        const lines: string[] = [];
        const app = createApp();
        app.use(selfHeal({ log: (line) => lines.push(line) }));
        app.use(chaos({ enabled: true, log: () => {} }));
        app.get("/search", () => "results");
        app.get("/health", () => "ok");

        const broken = { headers: { "X-Senri-Chaos": "status=503" } };
        for (let i = 0; i < 10; i++) {
            expect((await app.fetch(req("/search", broken))).status).toBe(503);
            expect((await app.fetch(req("/health"))).status).toBe(200);
        }
        expect(lines.at(-1)).toContain("GET /search を止めた");
        // 壊すのをやめても、10 秒は止めたまま
        expect((await app.fetch(req("/search"))).status).toBe(503);
        advance(10_000);
        expect(await (await app.fetch(req("/search"))).text()).toBe("results");
        expect(lines.at(-1)).toContain("GET /search を戻した");
    });
});

describe("selfHeal(): オプション", () => {
    const bad: [string, SelfHealOptions][] = [
        ["window", { window: 0 }],
        ["window", { window: "30" as "30s" }],
        ["window", { window: "-1s" as "1s" }],
        ["cooldown", { cooldown: Number.POSITIVE_INFINITY }],
        ["slow", { slow: "2 s" as "2s" }],
        ["minRequests", { minRequests: 0 }],
        ["minRequests", { minRequests: 1.5 }],
        ["threshold", { threshold: 0 }],
        ["threshold", { threshold: 1.1 }],
        ["log", { log: "console" as unknown as () => void }],
        ["options object", null as unknown as SelfHealOptions],
    ];
    for (const [what, options] of bad) {
        test(`${what} が正しくなければ TypeError`, () => {
            let err: unknown;
            try {
                selfHeal(options);
            } catch (e) {
                err = e;
            }
            expect(err).toBeInstanceOf(TypeError);
            expect((err as Error).message).toContain(what);
            expect(errorCode(err)).toBe("self_heal_options");
            expect(explainText(err, "ja")).toContain("selfHeal() の設定");
        });
    }

    test("時間は ms・s・m の単位でも書ける", async () => {
        const t = makeApp({ cooldown: "1.5s", window: "1m" });
        await trip(t);
        expect((await t.app.fetch(req("/users/1"))).headers.get("retry-after")).toBe("2");
        advance(1500);
        t.state.mode = "ok";
        expect(await hit(t.app, 1)).toEqual([200]);
    });

    test("Node の近道を止めない(純正のミドルウェアの印が付いている)", () => {
        expect(isPlainSafe(selfHeal({ log: () => {} }))).toBe(true);
    });

    test("ルートの use にも付けられる(endpoint・defineRoutes)", async () => {
        const app = createApp();
        let failing = true;
        app.routes(defineRoutes({ "GET /search": endpoint({ use: [selfHeal({ minRequests: 2, log: () => {} })] }, (_, c) => (failing ? c.text("down", 500) : "ok")) }));
        await hit(app, 2, "/search");
        expect((await app.fetch(req("/search"))).status).toBe(503);
        failing = false;
        advance(10_000);
        expect((await app.fetch(req("/search"))).status).toBe(200);
    });
});
