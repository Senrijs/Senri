import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createApp, health } from "../src/index.ts";
import { isDraining, setDraining } from "../src/health.ts";
import { serve } from "../adapters/serve/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

// setDraining はプロセス全体で1つの状態。ほかのテストファイル(serve() を止めるもの)が先に動いて true のまま残っていても、
// 順番に依存しないよう、前後の両方で戻す
beforeEach(() => setDraining(false));
afterEach(() => setDraining(false));

describe("health()", () => {
    test("/healthz は 200、/readyz は ready() しだい", async () => {
        let ok = true;
        const app = createApp();
        app.use(health({ ready: () => ok }));
        app.get("/", () => "home");

        const live = await app.fetch(req("/healthz"));
        expect([live.status, await live.text()]).toEqual([200, "ok"]);
        expect(live.headers.get("cache-control")).toBe("no-store");
        expect((await app.fetch(req("/readyz"))).status).toBe(200);
        ok = false;
        expect((await app.fetch(req("/readyz"))).status).toBe(503);
        // ほかのパスはそのまま通る
        expect(await (await app.fetch(req("/"))).text()).toBe("home");
    });

    test("ready() が例外を投げたら 503(中身は出さない)", async () => {
        const app = createApp();
        app.use(
            health({
                ready: async () => {
                    throw new Error("db down: secret");
                },
            }),
        );
        const res = await app.fetch(req("/readyz"));
        expect([res.status, await res.text()]).toEqual([503, "not ready"]);
    });

    test("止まり始めたら /readyz は 503、/healthz は 200 のまま", async () => {
        const app = createApp();
        app.use(health());
        setDraining(true);
        expect((await app.fetch(req("/readyz"))).status).toBe(503);
        expect((await app.fetch(req("/healthz"))).status).toBe(200);
    });

    test("パスは変えられる。false で出さない", async () => {
        const app = createApp();
        app.use(health({ path: "/live", readyPath: false }));
        expect((await app.fetch(req("/live"))).status).toBe(200);
        expect((await app.fetch(req("/readyz"))).status).toBe(404);
        expect((await app.fetch(req("/healthz"))).status).toBe(404);
    });

    test("GET と HEAD だけ答える", async () => {
        const app = createApp();
        app.use(health());
        expect((await app.fetch(req("/healthz", { method: "HEAD" }))).status).toBe(200);
        expect((await app.fetch(req("/healthz", { method: "POST" }))).status).toBe(404);
    });
});

describe("serve() の止め方(graceful shutdown)", () => {
    test("stop() は処理中のリクエストを待ち、その間 /readyz は 503", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const app = createApp();
        app.use(health());
        app.get("/slow", async () => {
            await gate;
            return "done";
        });
        const server = await serve(app, { port: 0, banner: false });

        const slow = fetch(`${server.url}/slow`);
        // リクエストがハンドラーに届くまで待つ
        await new Promise((r) => setTimeout(r, 100));
        const stopped = server.stop();
        expect(isDraining()).toBe(true);
        expect((await app.fetch(req("/readyz"))).status).toBe(503);

        release();
        const res = await slow;
        expect(await res.text()).toBe("done");
        await stopped;
        // 止まったあとは接続できない
        expect(fetch(`${server.url}/slow`)).rejects.toThrow();
    });

    test("shutdownTimeout を過ぎたら、残りの接続を切って止まる", async () => {
        const app = createApp();
        app.get("/hang", () => new Promise<string>(() => {}));
        const server = await serve(app, { port: 0, banner: false, shutdownTimeout: 200 });
        const hanging = fetch(`${server.url}/hang`).catch(() => "cut");
        await new Promise((r) => setTimeout(r, 100));
        const start = performance.now();
        await server.stop();
        expect(performance.now() - start).toBeLessThan(2000);
        expect(await hanging).toBe("cut");
    });

    test("SIGTERM を受けたら、止めて onShutdown を呼んでから終わる", async () => {
        const exit = spyOn(process, "exit").mockImplementation((() => undefined) as never);
        const log = spyOn(console, "log").mockImplementation(() => {});
        try {
            const calls: string[] = [];
            const server = await serve(createApp(), { port: 0, banner: false, onShutdown: () => void calls.push("onShutdown") });
            process.emit("SIGTERM");
            for (let i = 0; i < 50 && exit.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
            expect(calls).toEqual(["onShutdown"]);
            expect(exit).toHaveBeenCalledWith(0);
            expect(isDraining()).toBe(true);
            expect(fetch(`${server.url}/`)).rejects.toThrow();
        } finally {
            exit.mockRestore();
            log.mockRestore();
        }
    });

    test("シグナルのリスナーは、止めたあとに残らない", async () => {
        const before = process.listenerCount("SIGTERM");
        const server = await serve(createApp(), { port: 0, banner: false });
        expect(process.listenerCount("SIGTERM")).toBe(before + 1);
        await server.stop();
        expect(process.listenerCount("SIGTERM")).toBe(before);
    });

    test("gracefulShutdown: false ならシグナルを受けない", async () => {
        const before = process.listenerCount("SIGTERM");
        const server = await serve(createApp(), { port: 0, banner: false, gracefulShutdown: false });
        expect(process.listenerCount("SIGTERM")).toBe(before);
        await server.stop();
    });

    test("shutdownTimeout が正しくなければエラー", async () => {
        expect(serve(createApp(), { port: 0, banner: false, shutdownTimeout: -1 })).rejects.toThrow("shutdownTimeout");
    });
});
