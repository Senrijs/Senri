import { afterEach, describe, expect, test } from "bun:test";
import { createApp, type ExecutionContext } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { getIp } from "../src/ip.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

function fakeCtx() {
    const waited: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
        waitUntil: (p) => void waited.push(p),
        passThroughOnException: () => {},
    };
    return { ctx, waited };
}

// navigator.userAgent を Workers のものにする(テストの間だけ)
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function pretendWorkers() {
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
}
afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
});

describe("Cloudflare Workers の fetch(req, env, ctx)", () => {
    test("c.env と c.executionCtx に、2つ目と3つ目の引数が入る", async () => {
        const app = createApp<{ Bindings: { GREETING: string } }>();
        const { ctx, waited } = fakeCtx();
        app.get("/", (_, c) => {
            c.executionCtx.waitUntil(Promise.resolve("later"));
            return c.env.GREETING;
        });

        const res = await app.fetch(req("/"), { GREETING: "hello" }, ctx);

        expect(await res.text()).toBe("hello");
        expect(waited).toHaveLength(1);
    });

    test("ミドルウェアがあっても同じ(開発モードでも)", async () => {
        for (const dev of [false, true]) {
            const app = createApp<{ Bindings: { N: number } }>({ dev: dev ? devtools() : undefined });
            app.use(async (c, next) => {
                c.header("x-n", String(c.env.N));
                return next();
            });
            app.get("/", (_, c) => (c.executionCtx ? "ctx" : "none"));
            const res = await app.fetch(req("/"), { N: 1 }, fakeCtx().ctx);
            expect([res.headers.get("x-n"), await res.text()]).toEqual(["1", "ctx"]);
        }
    });

    test("Bun の server や Deno の info は env ではないので、c.env は undefined", async () => {
        const app = createApp();
        app.get("/", (_, c) => String(c.env));
        const bunServer = { requestIP: () => ({ address: "127.0.0.1" }) };
        const denoInfo = { remoteAddr: { hostname: "127.0.0.1", port: 1, transport: "tcp" } };
        for (const info of [bunServer, denoInfo, undefined]) {
            expect(await (await app.fetch(req("/"), info)).text()).toBe("undefined");
        }
    });

    test("ctx がないときに c.executionCtx を読むと、分かりやすいエラー", async () => {
        const app = createApp();
        let message = "";
        app.get("/", (_, c) => {
            try {
                c.executionCtx;
            } catch (err) {
                message = (err as Error).message;
            }
            return "ok";
        });
        await app.fetch(req("/"));
        expect(message).toContain("Cloudflare Workers");
    });

    test("export default app の形で呼べる(this を使わない)", async () => {
        const app = createApp<{ Bindings: { X: string } }>();
        app.get("/", (_, c) => c.env.X);
        const worker = { ...app };
        const { fetch } = worker;
        expect(await (await fetch(req("/"), { X: "x" }, fakeCtx().ctx)).text()).toBe("x");
    });
});

describe("Workers で動いているとき", () => {
    test("getIp(c) は Cloudflare が付ける CF-Connecting-IP から取る", async () => {
        pretendWorkers();
        const app = createApp();
        app.get("/", (_, c) => String(getIp(c)));
        const res = await app.fetch(req("/", { headers: { "cf-connecting-ip": "203.0.113.5" } }), {}, fakeCtx().ctx);
        expect(await res.text()).toBe("203.0.113.5");
    });

    test("Workers でなければ CF-Connecting-IP は読まない(偽装できるので)", async () => {
        const app = createApp();
        app.get("/", (_, c) => String(getIp(c)));
        const res = await app.fetch(req("/", { headers: { "cf-connecting-ip": "203.0.113.5" } }));
        expect(await res.text()).toBe("null");
    });

    test("開発モードでも、ダッシュボードは作らない(/_senri はふつうの 404)。ほかの開発用の機能は動く", async () => {
        // localhost からの接続に見える info を渡す(Workers でなければ、これでダッシュボードが開ける)
        const loopback = { requestIP: () => ({ address: "127.0.0.1" }) };
        const outside = createApp({ dev: devtools() });
        expect((await outside.fetch(req("/_senri/api/requests", { headers: { host: "localhost" } }), loopback)).status).toBe(200);

        pretendWorkers();
        const app = createApp({ dev: devtools() });
        app.get("/boom", () => {
            throw new Error("わざと");
        });

        const dashboard = await app.fetch(req("/_senri/api/requests", { headers: { host: "localhost" } }), loopback, fakeCtx().ctx);
        expect(dashboard.status).toBe(404);

        const page = await app.fetch(req("/boom", { headers: { accept: "text/html" } }), {}, fakeCtx().ctx);
        expect(page.status).toBe(500);
        expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(page.headers.get("server-timing")).toContain("senri-total");
    });
});
