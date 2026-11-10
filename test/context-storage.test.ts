import { describe, expect, test } from "bun:test";
import { createApp, type Context } from "../src/index.ts";
import { contextStorage, getContext, tryGetContext } from "../adapters/context-storage/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { streamText } from "../src/streaming.ts";

const req = (path: string) => new Request(`http://localhost${path}`);

// ハンドラーから呼ぶ、c を受け取らない関数
const currentPath = () => getContext().path;

// テストが合図するまで止めておくための約束
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
}

describe("contextStorage() / getContext()", () => {
    test("ハンドラーから呼んだ関数で、いまのリクエストの c が取れる(await のあとも)", async () => {
        const app = createApp();
        app.use(contextStorage());
        app.get("/items/:id", async (_, c) => {
            const before = getContext();
            await new Promise((r) => setTimeout(r, 1));
            await Promise.resolve();
            return { same: before === c && getContext() === c, path: currentPath() };
        });
        expect(await (await app.fetch(req("/items/1"))).json()).toEqual({ same: true, path: "/items/1" });
    });

    test("同時に処理しているリクエストの c が混ざらない", async () => {
        const app = createApp();
        app.use(contextStorage());
        const gates = new Map<string, ReturnType<typeof deferred>>([
            ["a", deferred()],
            ["b", deferred()],
        ]);
        app.get("/:name", async ({ name }) => {
            await gates.get(name)!.promise;
            return currentPath();
        });
        const a = app.fetch(req("/a"));
        const b = app.fetch(req("/b"));
        // 後から来た b を先に終わらせる
        gates.get("b")!.resolve();
        gates.get("a")!.resolve();
        expect([await (await a).text(), await (await b).text()]).toEqual(["/a", "/b"]);
    });

    test("後ろのミドルウェア・onError・notFound からも取れる", async () => {
        const app = createApp();
        app.use(contextStorage());
        app.use(async (c, next) => {
            c.header("x-from-middleware", String(getContext() === c));
            return next();
        });
        app.get("/boom", () => {
            throw new Error("boom");
        });
        app.onError((_, c) => `onError: ${getContext() === c}`);
        app.notFound((c) => c.text(`notFound: ${tryGetContext() === c}`, 404));
        const boom = await app.fetch(req("/boom"));
        expect([boom.headers.get("x-from-middleware"), await boom.text()]).toEqual(["true", "onError: true"]);
        expect(await (await app.fetch(req("/missing"))).text()).toBe("notFound: true");
    });

    test("ストリームの中(レスポンスを返したあと)でも取れる", async () => {
        const app = createApp();
        app.use(contextStorage());
        app.get("/stream", (_, c) =>
            streamText(c, async (s) => {
                await s.sleep(1);
                await s.write(`path=${currentPath()}`);
            }),
        );
        expect(await (await app.fetch(req("/stream"))).text()).toBe("path=/stream");
    });

    test("リクエストの外では、getContext() は Error(code: no_context)、tryGetContext() は undefined", () => {
        expect(tryGetContext()).toBeUndefined();
        let thrown: unknown;
        try {
            getContext();
        } catch (err) {
            thrown = err;
        }
        expect((thrown as { code?: string }).code).toBe("no_context");
        expect(explainText(thrown, "ja")).toContain("contextStorage()");
    });

    test("contextStorage() より前のミドルウェアでは取れない", async () => {
        const app = createApp();
        let early: Context | undefined | "unset" = "unset";
        app.use(async (_, next) => {
            early = tryGetContext();
            return next();
        });
        app.use(contextStorage());
        app.get("/", () => String(tryGetContext() !== undefined));
        expect(await (await app.fetch(req("/"))).text()).toBe("true");
        expect(early).toBeUndefined();
    });

    test("リクエストが終わったあとに残ったタイマーからは、そのリクエストの c が見える(AsyncLocalStorage の性質)", async () => {
        const app = createApp();
        app.use(contextStorage());
        const later = deferred();
        let seen: string | undefined;
        app.get("/later", () => {
            setTimeout(() => {
                seen = tryGetContext()?.path;
                later.resolve();
            }, 1);
            return "ok";
        });
        await app.fetch(req("/later"));
        await later.promise;
        expect(seen).toBe("/later");
    });

    test("Node の近道で使える(markPlainSafe)", () => {
        expect(isPlainSafe(contextStorage())).toBe(true);
    });
});
