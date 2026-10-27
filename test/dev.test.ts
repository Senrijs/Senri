import { describe, expect, test } from "bun:test";
import { createApp, type AppOptions } from "../src/index.ts";
import { explainDifference, suggest } from "../src/dev/suggest.ts";
import { devtools } from "../src/dev/index.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

function appWithRoutes(options?: AppOptions) {
    const app = createApp(options);
    app.get("/hello", () => "hi");
    app.get("/boom", () => {
        throw new Error("db password=hunter2");
    });
    return app;
}

describe("本番(既定)では固定の文言だけ返す", () => {
    test("500 にエラーメッセージを出さない", async () => {
        const res = await appWithRoutes().fetch(req("/boom"));

        expect(res.status).toBe(500);
        expect(await res.text()).toBe("500 Internal Server Error");
    });

    test("404 にパスも「もしかして」も出さない", async () => {
        const res = await appWithRoutes().fetch(req("/helo"));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("404 Not Found");
    });

    test("405 は固定文言 + Allow ヘッダー", async () => {
        const res = await appWithRoutes().fetch(req("/hello", { method: "POST" }));

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
        expect(await res.text()).toBe("405 Method Not Allowed");
    });

    test("環境変数(NODE_ENV)では開発モードにならない", async () => {
        const before = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";
        try {
            const res = await appWithRoutes().fetch(req("/boom"));
            expect(await res.text()).toBe("500 Internal Server Error");
        } finally {
            process.env.NODE_ENV = before;
        }
    });
});

describe("開発モード createApp({ dev: devtools() })", () => {
    test("500 にエラーメッセージが出る", async () => {
        const res = await appWithRoutes({ dev: devtools() }).fetch(req("/boom"));

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("db password=hunter2");
    });

    test("404 に「もしかして」が出る", async () => {
        const res = await appWithRoutes({ dev: devtools() }).fetch(req("/helo"));

        expect(await res.text()).toContain("もしかして: GET /hello");
    });

    test("「もしかして」はデコード・正規化したパスで探す", async () => {
        const app = createApp({ dev: devtools() });
        app.get("/こんにちは", () => "ok");
        app.get("/hello", () => "ok");

        const jp = await (await app.fetch(req("/こんにちわ"))).text();
        const slashes = await (await app.fetch(req("//helo/"))).text();

        expect(jp).toBe("404 Not Found: GET /こんにちわ\nもしかして: GET /こんにちは ?");
        expect(slashes).toBe("404 Not Found: GET /helo\nもしかして: GET /hello ?");
    });

    test("405 のメッセージも正規化したパスを出す", async () => {
        const res = await appWithRoutes({ dev: devtools() }).fetch(req("//hello/", { method: "POST" }));

        expect(await res.text()).toStartWith("405 Method Not Allowed: POST /hello\n");
    });

    test("405 にどのメソッドならあるかが出る", async () => {
        const res = await appWithRoutes({ dev: devtools() }).fetch(req("/hello", { method: "POST" }));

        expect(await res.text()).toContain("GET, HEAD, OPTIONS ならあります");
    });
});

describe("計測(c.timings)", () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    function measuredApp(options: AppOptions) {
        const app = createApp(options);
        let timings: unknown[] = [];
        // いちばん外側で、内側の計測結果を読む
        app.use(async function probe(c, next) {
            await next();
            timings = [...c.timings];
        });
        app.use(async function slow(_c, next) {
            await sleep(10);
            await next();
        });
        app.get("/x", async () => {
            await sleep(60);
            return "x";
        });
        return { app, read: () => timings as { name: string; total: number; self: number; start: number }[] };
    }

    test("開発モードでは、ミドルウェアとハンドラーの self / total が記録される", async () => {
        const { app, read } = measuredApp({ dev: devtools() });

        await app.fetch(req("/x"));
        const [, slow, handler] = read();

        expect(slow!.name).toBe("slow");
        expect(handler!.name).toBe("handler");
        // ハンドラーの時間は slow の self には入らない
        expect(handler!.self).toBeGreaterThanOrEqual(50);
        expect(slow!.self).toBeLessThan(40);
        // total = 自分の時間 + 下流の total
        expect(Math.abs(slow!.total - (slow!.self + handler!.total))).toBeLessThan(5);
    });

    test("例外が起きた層に failed が付く(ハンドラー)", async () => {
        const app = createApp({ dev: devtools() });
        let timings: { name: string; failed: boolean }[] = [];
        app.use(async function outer(c, next) {
            await next();
            timings = [...c.timings];
        });
        app.use(async function inner(_c, next) {
            await next();
        });
        app.get("/x", () => {
            throw new Error("boom");
        });

        await app.fetch(req("/x"));

        // timings[0] は outer 自身(読んだ時点ではまだ終わっていないので入っていない)
        expect(timings[1]).toMatchObject({ name: "inner", failed: false });
        expect(timings[2]).toMatchObject({ name: "handler", failed: true });
    });

    test("例外が起きた層に failed が付く(ミドルウェア)", async () => {
        const app = createApp({ dev: devtools() });
        let timings: { name: string; failed: boolean }[] = [];
        app.use(async function outer(c, next) {
            await next();
            timings = [...c.timings];
        });
        app.use(function auth() {
            throw new Error("auth failed");
        });
        app.get("/x", () => "x");

        await app.fetch(req("/x"));

        expect(timings[1]).toMatchObject({ name: "auth", failed: true });
        // ハンドラーまでは届いていない
        expect(timings[2]).toBeUndefined();
    });

    test("各層の開始時刻(リクエストの開始から)が入り、内側の層ほど後に始まる", async () => {
        const { app, read } = measuredApp({ dev: devtools() });

        await app.fetch(req("/x"));
        const [, slow, handler] = read();

        expect(slow!.start).toBeGreaterThanOrEqual(0);
        // slow は next() の前に 10ms 待つので、handler はその後に始まる
        expect(handler!.start).toBeGreaterThanOrEqual(slow!.start + 5);
    });

    test("next() を呼ばずに値を返して終わった層に stopped が付く", async () => {
        const app = createApp({ dev: devtools() });
        let timings: { name: string; stopped: boolean }[] = [];
        app.use(async function outer(c, next) {
            await next();
            timings = [...c.timings];
        });
        app.use(function auth(c) {
            c.status(401);
            return "ログインしてね";
        });
        app.get("/x", () => "x");

        await app.fetch(req("/x"));

        expect(timings[1]).toMatchObject({ name: "auth", stopped: true });
        expect(timings[2]).toBeUndefined();
    });

    test("next() のあとに値を返した層は stopped ではない", async () => {
        const app = createApp({ dev: devtools() });
        let timings: { name: string; stopped: boolean }[] = [];
        app.use(async function outer(c, next) {
            await next();
            timings = [...c.timings];
        });
        app.use(async function wrap(_c, next) {
            await next();
            return "上書き";
        });
        app.get("/x", () => "x");

        await app.fetch(req("/x"));

        expect(timings[1]).toMatchObject({ name: "wrap", stopped: false });
    });

    test("いちばん内側の層の名前は、何が動いたかで変わる(handler / notFound / 405 / options / 400)", async () => {
        const app = createApp({ dev: devtools() });
        let last = "";
        app.use(async function outer(c, next) {
            await next();
            last = c.timings.at(-1)!.name;
        });
        app.get("/x", () => "x");

        const cases: [string, RequestInit, string][] = [
            ["/x", {}, "handler"],
            ["/nope", {}, "notFound"],
            ["/x", { method: "DELETE" }, "405"],
            ["/x", { method: "OPTIONS" }, "options"],
            ["/%E0%A4%A", {}, "400"],
        ];
        for (const [path, init, name] of cases) {
            await app.fetch(req(path, init));
            expect(last).toBe(name);
        }
    });

    test("本番では計測しない", async () => {
        const { app, read } = measuredApp({});

        await app.fetch(req("/x"));

        expect(read()).toEqual([]);
    });
});

describe("「もしかして」のどこが違うか(explainDifference)", () => {
    test("1文字足りない: 足りない文字に印を付ける", () => {
        expect(explainDifference("/helo", "/hello")).toEqual({
            parts: [
                { text: "/hel", mark: false },
                { text: "l", mark: true },
                { text: "o", mark: false },
            ],
            note: '"l" が1文字足りません',
        });
    });

    test("続けて何文字か足りない", () => {
        expect(explainDifference("/usr", "/users").note).toBe('"es" が2文字足りません');
    });

    test("1文字多い: 候補のほうには印を付けない", () => {
        expect(explainDifference("/helllo", "/hello")).toEqual({
            parts: [{ text: "/hello", mark: false }],
            note: '"l" が1文字多いです',
        });
    });

    test("1文字違う", () => {
        expect(explainDifference("/userz", "/users")).toEqual({
            parts: [
                { text: "/user", mark: false },
                { text: "s", mark: true },
            ],
            note: '"s" のところが "z" になっています',
        });
    });

    test("大文字と小文字の違いも分かる", () => {
        expect(explainDifference("/Hello", "/hello").note).toBe('"h" のところが "H" になっています');
    });

    test("いろいろ違うときは、か所の数だけ", () => {
        expect(explainDifference("/hxlo", "/hello").note).toBe("2か所違います");
    });
});

describe("「もしかして」の計算が重くならない", () => {
    test("8KB のパス × 50 ルートでもすぐ終わる", () => {
        const routes = Array.from({ length: 50 }, (_, i) => ({ path: `/api/v1/resource${i}/:id/detail` }));
        const long = "/" + "a".repeat(8000);

        const start = performance.now();
        const result = suggest(routes, long);
        const ms = performance.now() - start;

        expect(result).toBeNull();
        expect(ms).toBeLessThan(5);
    });

    test("近いものはちゃんと見つかる", () => {
        expect(suggest([{ path: "/hello" }, { path: "/users" }], "/helo")).toEqual({ path: "/hello" });
    });
});
