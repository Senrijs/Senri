import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { explainDifference, suggest } from "../src/dev/suggest.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

function appWithRoutes(options?: { dev?: boolean }) {
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

describe("開発モード createApp({ dev: true })", () => {
    test("500 にエラーメッセージが出る", async () => {
        const res = await appWithRoutes({ dev: true }).fetch(req("/boom"));

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("db password=hunter2");
    });

    test("404 に「もしかして」が出る", async () => {
        const res = await appWithRoutes({ dev: true }).fetch(req("/helo"));

        expect(await res.text()).toContain("もしかして: GET /hello");
    });

    test("「もしかして」はデコード・正規化したパスで探す", async () => {
        const app = createApp({ dev: true });
        app.get("/こんにちは", () => "ok");
        app.get("/hello", () => "ok");

        const jp = await (await app.fetch(req("/こんにちわ"))).text();
        const slashes = await (await app.fetch(req("//helo/"))).text();

        expect(jp).toBe("404 Not Found: GET /こんにちわ\nもしかして: GET /こんにちは ?");
        expect(slashes).toBe("404 Not Found: GET /helo\nもしかして: GET /hello ?");
    });

    test("405 のメッセージも正規化したパスを出す", async () => {
        const res = await appWithRoutes({ dev: true }).fetch(req("//hello/", { method: "POST" }));

        expect(await res.text()).toStartWith("405 Method Not Allowed: POST /hello\n");
    });

    test("405 にどのメソッドならあるかが出る", async () => {
        const res = await appWithRoutes({ dev: true }).fetch(req("/hello", { method: "POST" }));

        expect(await res.text()).toContain("GET, HEAD, OPTIONS ならあります");
    });
});

describe("計測(c.timings)", () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    function measuredApp(options: { dev?: boolean }) {
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
        return { app, read: () => timings as { name: string; total: number; self: number }[] };
    }

    test("開発モードでは、ミドルウェアとハンドラーの self / total が記録される", async () => {
        const { app, read } = measuredApp({ dev: true });

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
