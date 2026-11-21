// ルートで決めた型を c とクライアントに届ける仕組み(#140・#141・#155)の、実行時の挙動
// 型は test/types.check.ts で確かめる
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { bodyLimit, createApp, createRouter, defineRoutes, endpoint, HttpError, type Middleware } from "../src/index.ts";
import { client } from "../src/client.ts";
import { devtools } from "../src/dev/index.ts";

const get = (app: { fetch(req: Request): Promise<Response> }, path: string, init?: RequestInit) =>
    app.fetch(new Request(`http://localhost${path}`, init));

type User = { name: string };

// ヘッダーに x-user があればログイン済み。なければ 401
const requireUser: Middleware<{}, { vars: { user: User }; errors: 401 }> = async (c, next) => {
    const name = c.req.headers.get("x-user");
    if (!name) throw new HttpError(401, "401 Unauthorized");
    c.set("user", { name });
    return next();
};
const asUser = { headers: { "x-user": "alice" } };

describe("app.get(path, { use }, handler)", () => {
    test("そのルートだけで動く。宣言した変数がハンドラーで読める", async () => {
        const app = createApp();
        app.get("/me", { use: [requireUser] }, (_, c) => c.get("user").name);
        app.get("/open", () => "open");
        expect(await (await get(app, "/me", asUser)).text()).toBe("alice");
        expect((await get(app, "/me")).status).toBe(401);
        expect(await (await get(app, "/open")).text()).toBe("open");
    });

    test("スキーマと一緒に: ミドルウェア → スキーマの確認 → ハンドラーの順", async () => {
        const order: string[] = [];
        const mark: Middleware = async (_, next) => {
            order.push("use");
            return next();
        };
        const app = createApp();
        app.post(
            "/notes/:id",
            { use: [mark], params: z.object({ id: z.coerce.number() }), body: z.object({ text: z.string() }) },
            ({ id }, c) => {
                order.push("handler");
                return { id, text: c.valid("body").text };
            },
        );
        const res = await get(app, "/notes/7", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
        expect(await res.json()).toEqual({ id: 7, text: "hi" });
        expect(order).toEqual(["use", "handler"]);
        // スキーマに通らなくても、ミドルウェアは先に動いている
        expect((await get(app, "/notes/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
        expect(order).toEqual(["use", "handler", "use"]);
    });

    test("app.on() でも使える", async () => {
        const app = createApp();
        app.on(["PUT", "PATCH"], "/me", { use: [requireUser] }, (_, c) => c.get("user").name);
        expect(await (await get(app, "/me", { method: "PATCH", ...asUser })).text()).toBe("alice");
        expect((await get(app, "/me", { method: "PUT" })).status).toBe(401);
    });

    test("use が配列でなければ、登録した時点でエラー", () => {
        const app = createApp();
        expect(() => app.get("/x", { use: requireUser as never }, () => "x")).toThrow("Invalid middleware");
    });

    test("開発モードでも、use はスキーマの書き間違いとして扱わない", async () => {
        const app = createApp({ dev: devtools({ lang: "en" }) });
        app.get("/me", { use: [requireUser] }, (_, c) => c.get("user").name);
        expect(await (await get(app, "/me", asUser)).text()).toBe("alice");
    });
});

describe("createRouter(prefix, { use })", () => {
    test("ルーターの全部のルートで動く(中のルーターも)。ほかのルートと、ルートのない 404 では動かない", async () => {
        const calls: string[] = [];
        const counted: Middleware = async (c, next) => {
            calls.push(c.path);
            return next();
        };
        const admin = createRouter("/admin", { use: [requireUser, counted] });
        admin.get("/me", (_, c) => c.get("user").name);
        const inner = createRouter("/settings");
        inner.get("/", () => "settings");
        admin.route(inner);

        const app = createApp();
        app.route(admin);
        app.get("/admin-free", () => "free");

        expect(await (await get(app, "/admin/me", asUser)).text()).toBe("alice");
        expect(await (await get(app, "/admin/settings", asUser)).text()).toBe("settings");
        expect((await get(app, "/admin/settings")).status).toBe(401);
        expect((await get(app, "/admin/nothing", asUser)).status).toBe(404);
        expect(await (await get(app, "/admin-free")).text()).toBe("free");
        expect(calls).toEqual(["/admin/me", "/admin/settings"]);
    });

    test("ルーターの use → ルートの use の順", async () => {
        const order: string[] = [];
        const named = (name: string): Middleware => async (_, next) => {
            order.push(name);
            return next();
        };
        const router = createRouter("/r", { use: [named("router")] });
        router.get("/x", { use: [named("route")] }, () => "x");
        const app = createApp();
        app.route(router);
        await get(app, "/r/x");
        expect(order).toEqual(["router", "route"]);
    });

    test("use が配列でなければエラー", () => {
        expect(() => createRouter("/r", { use: requireUser as never })).toThrow("Invalid middleware");
    });
});

describe("app.route(prefix, app) でつないだとき", () => {
    // 0.3 までは、つないだアプリのルートの use(endpoint() / defineRoutes() の use)が落ちていた
    test("ルートのミドルウェアも一緒につながる", async () => {
        const child = createApp();
        child.routes(defineRoutes({ "GET /me": endpoint({ use: [requireUser] }, (_, c) => c.get("user").name) }));
        child.get("/also", { use: [requireUser] }, () => "also");
        const app = createApp();
        app.route("/api", child);
        expect((await get(app, "/api/me")).status).toBe(401);
        expect(await (await get(app, "/api/me", asUser)).text()).toBe("alice");
        expect((await get(app, "/api/also")).status).toBe(401);
    });
});

describe("params のスキーマと c.params", () => {
    const toNumber = { params: z.object({ id: z.coerce.number() }) };

    test("ハンドラーの中では変換後の値。ミドルウェアの next() のあとでは文字列に戻る", async () => {
        const seen: unknown[] = [];
        const app = createApp();
        app.use(async (c, next) => {
            seen.push(c.params.id);
            await next();
            seen.push(c.params.id);
        });
        app.get("/notes/:id", toNumber, (params, c) => {
            seen.push(c.params.id);
            return { same: params.id === c.params.id };
        });
        expect(await (await get(app, "/notes/7")).json()).toEqual({ same: true });
        expect(seen).toEqual(["7", 7, "7"]);
    });

    test("ハンドラーが投げたときも、onError では文字列", async () => {
        const app = createApp();
        app.onError((_, c) => typeof c.params.id);
        app.get("/notes/:id", toNumber, () => {
            throw new Error("boom");
        });
        expect(await (await get(app, "/notes/7")).text()).toBe("string");
    });

    test("非同期のハンドラーが終わるまでは、変換後の値のまま", async () => {
        const app = createApp();
        app.get("/notes/:id", toNumber, async (_, c) => {
            await new Promise((r) => setTimeout(r, 1));
            return { id: c.params.id };
        });
        expect(await (await get(app, "/notes/7")).json()).toEqual({ id: 7 });
    });

    test('{ id: "int" } では、c.params は文字列のまま', async () => {
        const app = createApp();
        app.get("/n/:id", { params: { id: "int" } }, ({ id }, c) => ({ id, raw: c.params.id }));
        expect(await (await get(app, "/n/3")).json()).toEqual({ id: 3, raw: "3" });
    });
});

describe("bodyLimit() は、onError を渡さなければ HttpError を投げる", () => {
    test("Content-Length が上限を超えたら 413、数字でなければ 400。本文はアプリの onError が作る", async () => {
        const app = createApp();
        const seen: number[] = [];
        app.onError((err, c) => {
            if (err instanceof HttpError) seen.push(err.status);
            return c.json({ error: err instanceof HttpError ? err.message : "?" });
        });
        app.use(bodyLimit({ maxSize: 3 }));
        app.post("/", async (_, c) => c.text(await c.req.text()));

        const over = await get(app, "/", { method: "POST", body: "12345" });
        expect(over.status).toBe(413);
        expect(await over.json()).toEqual({ error: "413 Content Too Large" });
        const bad = await app.fetch(new Request("http://localhost/", { method: "POST", body: "1", headers: { "content-length": "x" } }));
        expect(bad.status).toBe(400);
        expect(seen).toEqual([413, 400]);
    });

    test("既定の onError なら、本文はこれまでと同じ", async () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 3 }));
        app.post("/", async (_, c) => c.text(await c.req.text()));
        const over = await get(app, "/", { method: "POST", body: "12345" });
        expect(over.status).toBe(413);
        expect(await over.text()).toBe("413 Content Too Large");
    });

    test("チャンク転送で超えたときも、アプリの onError を通る", async () => {
        const app = createApp();
        app.onError((err, c) => c.json({ status: err instanceof HttpError ? err.status : 500 }));
        app.use(bodyLimit({ maxSize: 3 }));
        app.post("/", async (_, c) => {
            try {
                await c.req.text();
            } catch {
                // 握りつぶしても 413 になる
            }
            return "swallowed";
        });
        const body = new Blob(["12345"]).stream();
        const res = await get(app, "/", { method: "POST", body, duplex: "half" } as RequestInit);
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({ status: 413 });
    });
});

describe("型付きクライアント: ミドルウェアが宣言した状態コード", () => {
    test("401 の本文は、サーバーの onError が返したもの", async () => {
        const routes = defineRoutes("/api", { use: [requireUser] })({
            "GET /me": (_, c) => ({ name: c.get("user").name }),
        });
        const app = createApp();
        app.onError((err, c) => c.json({ message: err instanceof HttpError ? err.message : "error" }));
        app.routes(routes);
        const api = client<typeof routes, { error: { message: string } }>("http://localhost", { fetch: app.fetch });

        const res = await api("GET /api/me");
        expect(res.status).toBe(401);
        if (res.status === 401) expect(res.error.message).toBe("401 Unauthorized");
        const ok = await api("GET /api/me", { headers: { "x-user": "bob" } });
        expect(ok.ok && ok.data.name).toBe("bob");
    });
});
