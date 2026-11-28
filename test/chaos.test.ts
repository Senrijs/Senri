import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createApp, endpoint, defineRoutes, type Middleware } from "../src/index.ts";
import { chaos, type ChaosOptions } from "../src/chaos.ts";
import { problemDetails } from "../src/problem.ts";
import { devtools } from "../src/dev/index.ts";
import { dashboardOf } from "../src/dev/registry.ts";
import { explainText } from "../src/dev/explain.ts";
import { errorCode } from "../src/errors.ts";
import { isPlainSafe } from "../src/plain.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const g = globalThis as { Deno?: unknown };

// ログはターミナルの言語で出るので、テストでは日本語に決める
const env = { NODE_ENV: process.env.NODE_ENV, LC_ALL: process.env.LC_ALL };
beforeEach(() => {
    process.env.LC_ALL = "ja_JP.UTF-8";
});
afterEach(() => {
    for (const [name, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    delete g.Deno;
});

// 起動時と、リクエストごとの行を集める
function makeApp(options: Omit<ChaosOptions, "log">, setup?: (app: ReturnType<typeof createApp>) => void) {
    const lines: string[] = [];
    const app = createApp();
    app.use(chaos({ ...options, log: (line) => lines.push(line) }));
    if (setup) setup(app);
    else app.get("/users/:id", ({ id }) => `user ${id}`);
    return { app, lines };
}

async function statuses(app: ReturnType<typeof createApp>, n: number): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await app.fetch(req(`/users/${i}`))).status);
    return out;
}

describe("chaos(): 本番の守り", () => {
    test("enabled: true がなければ、何もしない(警告も出さない)", async () => {
        for (const enabled of [false, "true" as unknown as boolean, undefined as unknown as boolean]) {
            const { app, lines } = makeApp({ enabled, errors: { rate: 1, status: 503 } });
            expect(await statuses(app, 3)).toEqual([200, 200, 200]);
            expect(lines).toEqual([]);
        }
    });

    test("enabled: false でも、オプションの書き間違いは起動時に知らせる", () => {
        expect(() => chaos({ enabled: false, errors: { rate: 2, status: 503 } })).toThrow("errors.rate");
    });

    test("NODE_ENV=production で enabled: true なら、起動時にエラーで止める", () => {
        process.env.NODE_ENV = "production";
        let err: unknown;
        try {
            chaos({ enabled: true, errors: { rate: 1, status: 503 } });
        } catch (e) {
            err = e;
        }
        expect(errorCode(err)).toBe("chaos_production");
        expect((err as Error).message).toContain("NODE_ENV is production");
        expect(explainText(err, "ja")).toContain("本番では動きません");
    });

    test("NODE_ENV=production でも、enabled: false なら止めない(消し忘れても動かないだけ)", async () => {
        process.env.NODE_ENV = "production";
        const { app } = makeApp({ enabled: false, errors: { rate: 1, status: 503 } });
        expect(await statuses(app, 1)).toEqual([200]);
    });

    test("Deno で NODE_ENV を読む許可がなければ、本番かもしれないのでエラーで止める", () => {
        g.Deno = {
            permissions: { querySync: () => ({ state: "prompt" }) },
            env: {
                get: () => {
                    throw new Error("asked for permission");
                },
            },
            cwd: () => "/",
        };
        expect(() => chaos({ enabled: true, log: () => {} })).toThrow("--allow-env=NODE_ENV");
    });

    test("動くときは、起動時に何をするかと種を警告する", () => {
        const { lines } = makeApp({ enabled: true, seed: 42, latency: { rate: 0.1, ms: [200, 2000] }, errors: { rate: 0.05, status: [500, 503] }, throws: { rate: 0.02 } });
        expect(lines).toEqual([
            "[senri] chaos() が有効です: リクエストをわざと遅らせたり、失敗させたりします。デプロイする前に外すか、enabled: false にしてください",
            "[senri]   遅延: リクエストの 10% に 200-2000 ms",
            "[senri]   エラー: リクエストの 5% に状態コード 500, 503",
            "[senri]   例外: リクエストの 2% で投げる",
            "[senri]   シード: 42(seed: 42 を渡すと、同じ順番で壊れます)",
            "[senri]   X-Senri-Chaos ヘッダー: latency=<ミリ秒>、status=<400〜599>、throw、none(カンマ区切り)",
        ]);
    });

    test("既定の出力先は console.warn", () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            chaos({ enabled: true });
            expect(warn.mock.calls[0]?.[0]).toContain("chaos() が有効です");
        } finally {
            warn.mockRestore();
        }
    });

    test("種を省くと、ちがう種を選んで警告に出す(それを渡せば同じ順番になる)", async () => {
        const { lines } = makeApp({ enabled: true, errors: { rate: 0.5, status: 503 } });
        const seed = Number(/シード: (\d+)/.exec(lines.join("\n"))?.[1]);
        expect(Number.isInteger(seed)).toBe(true);
        const a = makeApp({ enabled: true, seed, errors: { rate: 0.5, status: 503 } });
        const b = makeApp({ enabled: true, seed, errors: { rate: 0.5, status: 503 } });
        expect(await statuses(a.app, 20)).toEqual(await statuses(b.app, 20));
    });

    test("Workers とブラウザでは、本番かどうか確かめられないので、デプロイしないよう警告する", () => {
        const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        const lines: string[] = [];
        try {
            Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
            chaos({ enabled: true, log: (line) => lines.push(line) });
        } finally {
            if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
        }
        expect(lines.at(-1)).toBe("[senri]   ここでは NODE_ENV を読めないので、chaos() は本番かどうかを確かめられません。本番にデプロイしないでください");
    });
});

describe("chaos(): 壊し方", () => {
    test("errors: 状態コードを返す。onError を通るので、アプリのエラーの形になる", async () => {
        const { app, lines } = makeApp({ enabled: true, errors: { rate: 1, status: 503 } });
        const res = await app.fetch(req("/users/7?token=secret"));
        expect([res.status, await res.text()]).toEqual([503, "Injected by chaos() on purpose"]);
        // クエリは出さない(秘密が入っていることがある)
        expect(lines.at(-1)).toBe("[senri] chaos: GET /users/7 で 503 を返した");

        const withProblem = makeApp({ enabled: true, errors: { rate: 1, status: 500 } }, (a) => {
            const { onError } = problemDetails();
            a.onError(onError);
            a.get("/x", () => "x");
        });
        const problem = await withProblem.app.fetch(req("/x"));
        expect(problem.headers.get("content-type")).toBe("application/problem+json");
        expect(await problem.json()).toMatchObject({ status: 500, detail: "Injected by chaos() on purpose" });
    });

    test("errors: ハンドラーには届かない", async () => {
        let called = 0;
        const { app } = makeApp({ enabled: true, errors: { rate: 1, status: 500 } }, (a) =>
            a.get("/x", () => {
                called++;
                return "x";
            }),
        );
        await app.fetch(req("/x"));
        expect(called).toBe(0);
    });

    test("throws: ハンドラーのバグと同じく、例外として onError に届く", async () => {
        let seen: unknown;
        const { app, lines } = makeApp({ enabled: true, throws: { rate: 1 } }, (a) => {
            a.onError((err, c) => {
                seen = err;
                return c.text("oops", 500);
            });
            a.get("/x", () => "x");
        });
        const res = await app.fetch(req("/x"));
        expect([res.status, await res.text()]).toEqual([500, "oops"]);
        expect(errorCode(seen)).toBe("chaos_throw");
        expect(explainText(seen, "ja")).toContain("chaos() がわざと投げたもの");
        expect(lines.at(-1)).toBe("[senri] chaos: GET /x で例外を投げた");
    });

    test("latency: 遅らせてから、ふつうに通す", async () => {
        const { app, lines } = makeApp({ enabled: true, latency: { rate: 1, ms: 40 } });
        const start = performance.now();
        const res = await app.fetch(req("/users/1"));
        expect(performance.now() - start).toBeGreaterThanOrEqual(35);
        expect([res.status, await res.text()]).toEqual([200, "user 1"]);
        expect(lines.at(-1)).toBe("[senri] chaos: GET /users/1 に 40ms の遅延を入れた");
    });

    test("latency と errors が両方当たれば、遅らせてから返す。throws は errors より先", async () => {
        const both = makeApp({ enabled: true, latency: { rate: 1, ms: 1 }, errors: { rate: 1, status: 502 } });
        expect((await both.app.fetch(req("/users/1"))).status).toBe(502);
        expect(both.lines.at(-1)).toBe("[senri] chaos: GET /users/1 に 1ms の遅延を入れてから、502 を返した");

        const all = makeApp({ enabled: true, latency: { rate: 1, ms: 1 }, errors: { rate: 1, status: 502 }, throws: { rate: 1 } });
        expect((await all.app.fetch(req("/users/1"))).status).toBe(500);
        expect(all.lines.at(-1)).toBe("[senri] chaos: GET /users/1 に 1ms の遅延を入れてから、例外を投げた");
    });

    test("rate: 0 なら壊さない。何も壊さないリクエストは、ログに出さない", async () => {
        const { app, lines } = makeApp({ enabled: true, latency: { rate: 0, ms: 10 }, errors: { rate: 0, status: 503 }, throws: { rate: 0 } });
        const before = lines.length;
        expect(await statuses(app, 10)).toEqual(new Array(10).fill(200));
        expect(lines.length).toBe(before);
    });

    test("割合はだいたいそのとおり", async () => {
        const { app } = makeApp({ enabled: true, seed: 7, errors: { rate: 0.3, status: 503 } });
        const failed = (await statuses(app, 1000)).filter((s) => s === 503).length;
        expect(failed).toBeGreaterThan(250);
        expect(failed).toBeLessThan(350);
    });

    test("status の配列からは、どれも選ばれる", async () => {
        const { app } = makeApp({ enabled: true, seed: 1, errors: { rate: 1, status: [500, 502, 503] } });
        expect(new Set(await statuses(app, 100))).toEqual(new Set([500, 502, 503]));
    });

    test("latency の範囲 [min, max] の中で選ぶ", async () => {
        const { app, lines } = makeApp({ enabled: true, seed: 3, latency: { rate: 1, ms: [1, 5] } });
        await statuses(app, 20);
        const ms = lines.flatMap((line) => /に (\d+)ms/.exec(line)?.[1] ?? []).map(Number);
        expect(ms.length).toBe(20);
        expect(ms.every((n) => n >= 1 && n <= 5)).toBe(true);
        expect(new Set(ms).size).toBeGreaterThan(1);
    });
});

describe("chaos(): 種", () => {
    const options = { enabled: true, errors: { rate: 0.4, status: [500, 503] }, throws: { rate: 0.1 } } as const;

    test("同じ種なら、同じ順番で壊れる", async () => {
        const a = makeApp({ ...options, seed: 42 });
        const b = makeApp({ ...options, seed: 42 });
        const first = await statuses(a.app, 50);
        expect(await statuses(b.app, 50)).toEqual(first);
        expect(new Set(first)).toEqual(new Set([200, 500, 503]));
        expect(await statuses(makeApp({ ...options, seed: 43 }).app, 50)).not.toEqual(first);
    });

    test("遅延の割合を変えても、エラーの順番はずれない", async () => {
        const without = makeApp({ ...options, seed: 42 });
        const withLatency = makeApp({ ...options, seed: 42, latency: { rate: 0.5, ms: 0 } });
        expect(await statuses(withLatency.app, 50)).toEqual(await statuses(without.app, 50));
    });

    test("ヘッダーで決めたリクエストも、乱数を同じ数だけ使う(後ろのリクエストの壊れ方は変わらない)", async () => {
        const a = makeApp({ ...options, seed: 42 });
        const b = makeApp({ ...options, seed: 42 });
        await a.app.fetch(req("/users/0"));
        await b.app.fetch(req("/users/0", { headers: { "x-senri-chaos": "none" } }));
        expect(await statuses(b.app, 30)).toEqual(await statuses(a.app, 30));
    });
});

describe("chaos(): X-Senri-Chaos ヘッダー", () => {
    // 割合は 0 にしておく(ヘッダーだけで壊れることを確かめる)
    const quiet = { enabled: true, errors: { rate: 0, status: 500 } } as const;

    test("status=503 で、その状態コードを確実に返す", async () => {
        const { app, lines } = makeApp(quiet);
        expect((await app.fetch(req("/users/1", { headers: { "X-Senri-Chaos": "status=503" } }))).status).toBe(503);
        expect(lines.at(-1)).toBe("[senri] chaos: GET /users/1 で 503 を返した(X-Senri-Chaos ヘッダー)");
    });

    test("throw で例外を投げる", async () => {
        const { app } = makeApp(quiet);
        expect((await app.fetch(req("/users/1", { headers: { "X-Senri-Chaos": "throw" } }))).status).toBe(500);
    });

    test("latency と組み合わせられる(大文字・空白も読む)", async () => {
        const { app, lines } = makeApp(quiet);
        const res = await app.fetch(req("/users/1", { headers: { "X-Senri-Chaos": " Latency=5 , STATUS=429" } }));
        expect(res.status).toBe(429);
        expect(lines.at(-1)).toBe("[senri] chaos: GET /users/1 に 5ms の遅延を入れてから、429 を返した(X-Senri-Chaos ヘッダー)");
    });

    test("none なら、割合で当たっても壊さない", async () => {
        const { app } = makeApp({ enabled: true, errors: { rate: 1, status: 500 } });
        expect((await app.fetch(req("/users/1", { headers: { "X-Senri-Chaos": "none" } }))).status).toBe(200);
    });

    test("書き間違いは 400 で、何が読めなかったかを返す", async () => {
        const { app } = makeApp(quiet);
        const cases: [string, string][] = [
            ["status=200", "status must be from 400 to 599"],
            ["status=abc", "status must be from 400 to 599"],
            ["latency=-1", "latency must be milliseconds"],
            ["latency=1.5", "latency must be milliseconds"],
            ["latency", "latency must be milliseconds"],
            ["slow=1", 'unknown "slow"'],
            ["throw=1", '"throw" takes no value'],
            ["status=503,status=500", '"status" is given twice'],
            ["none,throw", '"none" cannot be combined'],
            ["throw,status=503", '"throw" and "status" cannot be combined'],
            ["", 'cannot read ""'],
            ["a=1=2", 'cannot read "a=1=2"'],
        ];
        for (const [header, message] of cases) {
            const res = await app.fetch(req("/users/1", { headers: { "X-Senri-Chaos": header } }));
            expect(res.status).toBe(400);
            expect(await res.text()).toContain(message);
        }
    });

    test("enabled でなければ、ヘッダーも読まない", async () => {
        const { app } = makeApp({ enabled: false });
        expect((await app.fetch(req("/users/1", { headers: { "X-Senri-Chaos": "status=503" } }))).status).toBe(200);
    });
});

describe("chaos(): オプションの検査", () => {
    const bad: [string, ChaosOptions][] = [
        ["latency.rate", { enabled: true, latency: { rate: -0.1, ms: 10 } }],
        ["latency.rate", { enabled: true, latency: { rate: Number.NaN, ms: 10 } }],
        ["latency.ms", { enabled: true, latency: { rate: 0.1, ms: -1 } }],
        ["latency.ms", { enabled: true, latency: { rate: 0.1, ms: [10, 5] } }],
        ["latency.ms", { enabled: true, latency: { rate: 0.1, ms: [10] as unknown as [number, number] } }],
        ["latency.ms", { enabled: true, latency: { rate: 0.1, ms: 2 ** 31 } }],
        ["errors.rate", { enabled: true, errors: { rate: 1.5, status: 503 } }],
        ["errors.status", { enabled: true, errors: { rate: 0.1, status: 200 } }],
        ["errors.status", { enabled: true, errors: { rate: 0.1, status: [] } }],
        ["errors.status", { enabled: true, errors: { rate: 0.1, status: [503, 600] } }],
        ["throws.rate", { enabled: true, throws: { rate: 2 } }],
        ["seed", { enabled: true, seed: 1.5 }],
        ["log", { enabled: true, log: "console" as unknown as () => void }],
        ["options object", null as unknown as ChaosOptions],
    ];
    for (const [what, options] of bad) {
        test(`${what} が正しくなければ TypeError`, () => {
            let err: unknown;
            try {
                chaos(options);
            } catch (e) {
                err = e;
            }
            expect(err).toBeInstanceOf(TypeError);
            expect((err as Error).message).toContain(what);
            expect(errorCode(err)).toBe("chaos_options");
            expect(explainText(err, "ja")).toContain("chaos() の設定");
        });
    }
});

describe("chaos(): ほかとの関係", () => {
    test("Node の近道を止めない(純正のミドルウェアの印が付いている)", () => {
        expect(isPlainSafe(chaos({ enabled: false }))).toBe(true);
        expect(isPlainSafe(chaos({ enabled: true, log: () => {} }))).toBe(true);
    });

    test("型には状態コードを足さない(errors を宣言しない)", () => {
        const mw = chaos({ enabled: false });
        // Middleware<any, {}> のまま。errors を宣言したミドルウェアには代入できない
        const plain: Middleware<any, {}> = mw;
        // @ts-expect-error chaos() は errors を宣言しない
        const declared: Middleware<any, { errors: 503 }> = mw;
        expect([plain, declared]).toHaveLength(2);
        const table = defineRoutes({ "GET /x": endpoint({ use: [mw] }, () => "x") });
        expect(Object.keys(table)).toEqual(["GET /x"]);
    });

    test("/_senri の記録に、何をしたかが「カオス」として残る", async () => {
        process.env.NODE_ENV = "development";
        // 画面の言語は Accept-Language で決まる
        const app = createApp({ dev: devtools() });
        app.use(chaos({ enabled: true, log: () => {} }));
        app.get("/users/:id", ({ id }) => id);
        await app.fetch(req("/users/1", { headers: { "X-Senri-Chaos": "latency=1,status=503", "accept-language": "ja" } }));
        await app.fetch(req("/users/2", { headers: { "accept-language": "en" } }));
        await app.fetch(req("/users/3", { headers: { "X-Senri-Chaos": "status=503", "accept-language": "en" } }));

        // 新しい順に並んでいるので、古い順にする
        const records = (await dashboardOf(app))!.log.list().toReversed();
        expect(records.map((r) => r.notes)).toEqual([
            [{ layer: "chaos", tag: "カオス", text: "GET /users/1 に 1ms の遅延を入れてから、503 を返した(X-Senri-Chaos ヘッダー)" }],
            [],
            [{ layer: "chaos", tag: "chaos", text: "responded 503 to GET /users/3 (X-Senri-Chaos)" }],
        ]);
        // タイムラインの層の名前と、notes の layer が合う
        expect(records[0]!.layers[0]!.name).toBe("chaos");
    });
});
