import { afterEach, describe, expect, test } from "bun:test";
import { createApp, HttpError } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

// 本番モードでは、開発用の計測・記録が一切動かないこと(時計も読まない)
describe("本番モード", () => {
    const realNow = performance.now;
    const realDateNow = Date.now;
    let clockReads = 0;

    function watchClock() {
        clockReads = 0;
        performance.now = () => (clockReads++, realNow.call(performance));
        Date.now = () => (clockReads++, realDateNow());
    }

    afterEach(() => {
        performance.now = realNow;
        Date.now = realDateNow;
    });

    function prodApp() {
        const app = createApp();
        let timings: unknown[] = [];
        app.use(async function outer(c, next) {
            await next();
            timings = [...c.timings];
        });
        app.get("/ok", () => "ok");
        app.get("/boom", () => {
            throw new Error("boom");
        });
        app.get("/teapot", () => {
            throw new HttpError(418, "teapot");
        });
        return { app, timings: () => timings };
    }

    test("ミドルウェアがあっても、計測しない・Server-Timing を付けない・時計を読まない", async () => {
        const { app, timings } = prodApp();
        watchClock();
        for (const path of ["/ok", "/boom", "/teapot", "/missing", "/_senri"]) {
            const res = await app.fetch(req(path));
            expect(res.headers.get("server-timing")).toBeNull();
            await res.text();
        }
        expect(clockReads).toBe(0);
        expect(timings()).toEqual([]);
    });

    test("ミドルウェアがない近道でも、時計を読まない", async () => {
        const app = createApp();
        app.get("/ok", () => "ok");
        app.get("/async", async () => ({ ok: true }));
        watchClock();
        for (const [path, method] of [["/ok", "GET"], ["/ok", "HEAD"], ["/ok", "OPTIONS"], ["/ok", "POST"], ["/async", "GET"]] as const) {
            const res = await app.fetch(req(path, { method }));
            expect(res.headers.get("server-timing")).toBeNull();
            await res.text();
        }
        expect(clockReads).toBe(0);
    });

    test("/_senri は本番ではただの 404(ダッシュボードはない)", async () => {
        const app = createApp();
        const res = await app.fetch(req("/_senri"));
        expect(res.status).toBe(404);
    });
});

// ミドルウェアがないときの近道と、ミドルウェアを通る道で、結果が同じになること
describe("近道と compose の道で同じ結果", () => {
    function build(withMiddleware: boolean) {
        const app = createApp();
        if (withMiddleware) app.use((_c, next) => next());
        app.get("/sync", (_p, c) => c.header("x-a", "1").text("sync"));
        app.get("/async", async () => ({ ok: true }));
        app.get("/throw", () => {
            throw new HttpError(409, "conflict");
        });
        app.get("/reject", async () => {
            throw new HttpError(422, "bad");
        });
        // 関数を返すのは変換エラー(500)
        app.get("/convert", (() => () => "x") as never);
        app.post("/only-post", () => "posted");
        return app;
    }

    const cases: [string, string][] = [
        ["GET", "/sync"],
        ["HEAD", "/sync"],
        ["GET", "/async"],
        ["GET", "/throw"],
        ["GET", "/reject"],
        ["GET", "/convert"],
        ["GET", "/only-post"],
        ["OPTIONS", "/only-post"],
        ["GET", "/missing"],
        ["GET", "/%E0%A4%A"],
    ];

    for (const [method, path] of cases) {
        test(`${method} ${path}`, async () => {
            const [a, b] = await Promise.all(
                [build(false), build(true)].map(async (app) => {
                    const res = await app.fetch(req(path, { method }));
                    return {
                        status: res.status,
                        type: res.headers.get("content-type"),
                        allow: res.headers.get("allow"),
                        xa: res.headers.get("x-a"),
                        body: await res.text(),
                    };
                }),
            );
            expect(a).toEqual(b!);
        });
    }
});
