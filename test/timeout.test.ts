import { describe, expect, test } from "bun:test";
import { createApp, HttpError, timeout } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf, CONTEXT_MARKER } from "./bundle.ts";

const req = (path: string) => new Request(`http://localhost${path}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("timeout()", () => {
    test("時間内に終われば、そのまま返す", async () => {
        const app = createApp();
        app.use(timeout(1000));
        app.get("/", async () => {
            await sleep(1);
            return "ok";
        });

        const res = await app.fetch(req("/"));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ok");
    });

    // 時間を測る代わりに、テストが合図するまでハンドラーを終わらせない
    // timeout() がハンドラーを待つなら、fetch が返らずに時間切れになる
    test("時間切れなら、待たずに 504 で返す", async () => {
        let finish = () => {};
        const handlerDone = new Promise<void>((resolve) => (finish = resolve));
        const app = createApp();
        app.use(timeout(10));
        app.get("/", async () => {
            await handlerDone;
            return "late";
        });

        const res = await app.fetch(req("/"));
        finish();
        expect(res.status).toBe(504);
        expect(await res.text()).toBe("504 Gateway Timeout");
    });

    test("status を変えられる", async () => {
        const app = createApp();
        app.use(timeout(10, { status: 503 }));
        app.get("/", () => sleep(100).then(() => "late"));

        const res = await app.fetch(req("/"));
        expect(res.status).toBe(503);
        expect(await res.text()).toBe("503 Timeout");
    });

    test("onError に HttpError が届く。c.error にも入る", async () => {
        const app = createApp();
        let error: unknown;
        app.use(async (c, next) => {
            const res = await next();
            error = c.error;
            return res;
        });
        app.use(timeout(10));
        app.onError((err) => ({ status: err instanceof HttpError ? err.status : 0 }));
        app.get("/", () => sleep(100).then(() => "late"));

        const res = await app.fetch(req("/"));
        expect(res.status).toBe(504);
        expect(await res.json()).toEqual({ status: 504 });
        expect((error as HttpError).status).toBe(504);
    });

    test("外側のミドルウェアは、504 のレスポンスを受け取る", async () => {
        const app = createApp();
        let seen = 0;
        app.use(async (_c, next) => {
            seen = (await next()).status;
        });
        app.use(timeout(10));
        app.get("/", () => sleep(100).then(() => "late"));

        await app.fetch(req("/"));
        expect(seen).toBe(504);
    });

    test("時間内のエラーは、そのまま onError に届く", async () => {
        const app = createApp();
        app.use(timeout(1000));
        app.get("/http", () => {
            throw new HttpError(403, "no");
        });
        app.get("/boom", () => {
            throw new Error("boom");
        });

        expect((await app.fetch(req("/http"))).status).toBe(403);
        expect((await app.fetch(req("/boom"))).status).toBe(500);
        expect((await app.fetch(req("/none"))).status).toBe(404);
    });

    test("処理は止まらない。あとで起きたエラーも onError に届き、応答は変わらない", async () => {
        const app = createApp();
        const errors: unknown[] = [];
        let finished = false;
        app.use(timeout(10));
        app.onError((err) => {
            errors.push(err);
            return "error";
        });
        app.get("/", async () => {
            await sleep(40);
            finished = true;
            throw new Error("late");
        });

        const res = await app.fetch(req("/"));
        expect(res.status).toBe(504);
        expect(finished).toBe(false);

        await sleep(80);
        expect(finished).toBe(true);
        expect(errors.map((e) => (e as Error).message)).toEqual(["504 Gateway Timeout", "late"]);
    });

    test("c.req.signal は、時間切れでは abort しない", async () => {
        const app = createApp();
        let signal: AbortSignal | undefined;
        app.use(timeout(10));
        app.get("/", async (_, c) => {
            signal = c.req.signal;
            await sleep(50);
            return "late";
        });

        await app.fetch(req("/"));
        await sleep(70);
        expect(signal?.aborted).toBe(false);
    });

    test("同期で止まっているあいだは、タイマーも動かない", async () => {
        const app = createApp();
        app.use(timeout(5));
        app.get("/", () => {
            const end = Date.now() + 40;
            while (Date.now() < end);
            return "sync";
        });

        const res = await app.fetch(req("/"));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("sync");
    });

    test("next() が返ったあとのストリームは、時間を数えない", async () => {
        const app = createApp();
        app.use(timeout(10));
        app.get("/", () => {
            return new Response(
                new ReadableStream({
                    async start(controller) {
                        await sleep(40);
                        controller.enqueue(new TextEncoder().encode("late chunk"));
                        controller.close();
                    },
                }),
            );
        });

        expect(await (await app.fetch(req("/"))).text()).toBe("late chunk");
    });

    test("時間切れのあとに届いたストリームは閉じる", async () => {
        const app = createApp();
        let cancelled = false;
        app.use(timeout(5));
        app.get("/", async () => {
            await sleep(30);
            return new Response(
                new ReadableStream({
                    cancel() {
                        cancelled = true;
                    },
                }),
            );
        });

        expect((await app.fetch(req("/"))).status).toBe(504);
        await sleep(60);
        expect(cancelled).toBe(true);
    });

    test("開発モードでも、504 を返して、あとから終わっても壊れない", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.use(timeout(5));
        app.get("/", () => sleep(30).then(() => "late"));

        const res = await app.fetch(new Request("http://localhost/", { headers: { host: "localhost" } }));
        expect(res.status).toBe(504);
        await sleep(60);
    });

    test("設定が不正なら、作るときに投げる。開発モードの説明がある", () => {
        for (const ms of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, "1000" as unknown as number]) {
            let err: unknown;
            try {
                timeout(ms);
            } catch (e) {
                err = e;
            }
            expect(explainText(err, "ja")).toContain("ミリ秒");
        }
        for (const status of [200, 399, 600, 504.5]) {
            let err: unknown;
            try {
                timeout(1, { status });
            } catch (e) {
                err = e;
            }
            expect(explainText(err, "ja")).toContain("status");
        }
    });

    test("名前と印", () => {
        const middleware = timeout(1);

        expect(middleware.name).toBe("timeout");
        expect(isPlainSafe(middleware)).toBe(true);
    });
});

describe("timeout() とバンドル", () => {
    test("timeout だけなら、Context が入らない", async () => {
        expect(await bundleOf("timeout")).not.toContain(CONTEXT_MARKER);
    });

    test("使わなければ、本体に入らない", async () => {
        const code = await bundleOf("createApp");

        expect(code).toContain(CONTEXT_MARKER);
        expect(code).not.toContain("Gateway Timeout");
    });
});
