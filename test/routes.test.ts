import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createApp, defineRoutes, endpoint, mergeRoutes, ValidationError, type Middleware } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";

const get = (app: { fetch(req: Request): Response | Promise<Response> }, path: string, init?: RequestInit) =>
    app.fetch(new Request(`http://localhost${path}`, init));
const postJson = (app: { fetch(req: Request): Response | Promise<Response> }, path: string, body: unknown) =>
    get(app, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("defineRoutes()", () => {
    test("前置きなし: キーはそのまま。app.routes() で登録できる", async () => {
        const routes = defineRoutes({
            "GET /users/:id": ({ id }) => ({ id }),
            "GET /text": () => "hi",
        });
        expect(Object.keys(routes)).toEqual(["GET /users/:id", "GET /text"]);

        const app = createApp();
        app.routes(routes);
        expect(await (await get(app, "/users/42")).json()).toEqual({ id: "42" });
        expect(await (await get(app, "/text")).text()).toBe("hi");
    });

    test("前置きあり: キーに前置きを付ける。\"/\" は前置きだけになる。前置きのパラメーターも届く", async () => {
        const routes = defineRoutes("/orgs/:orgId")({
            "GET /": ({ orgId }) => `org ${orgId}`,
            "GET /members/:memberId": ({ orgId, memberId }) => ({ orgId, memberId }),
        });
        expect(Object.keys(routes)).toEqual(["GET /orgs/:orgId", "GET /orgs/:orgId/members/:memberId"]);

        const app = createApp();
        app.routes(routes);
        expect(await (await get(app, "/orgs/a")).text()).toBe("org a");
        expect(await (await get(app, "/orgs/a/members/b")).json()).toEqual({ orgId: "a", memberId: "b" });
    });

    test("前置きが \"\" か \"/\" なら、前置きなしと同じ", () => {
        expect(Object.keys(defineRoutes("")({ "GET /a": () => "a" }))).toEqual(["GET /a"]);
        expect(Object.keys(defineRoutes("/")({ "GET /a": () => "a" }))).toEqual(["GET /a"]);
    });

    test("前置きは \"/\" で始まり、\"/\" で終わらない。違えばエラー", () => {
        expect(() => defineRoutes("users")).toThrow("Invalid prefix");
        expect(() => defineRoutes("/users/")).toThrow("Invalid prefix");
    });

    test("キーの書き方と値が違えばエラー", () => {
        expect(() => defineRoutes({ "GET/a": () => "a" } as never)).toThrow('Invalid route key: "GET/a"');
        expect(() => defineRoutes({ "GET a": () => "a" } as never)).toThrow('Invalid route key: "GET a"');
        expect(() => defineRoutes({ "GET /a": "a" } as never)).toThrow('Invalid route: "GET /a"');
        // スキーマとハンドラーを、endpoint() で包まずに書いた
        expect(() => defineRoutes({ "GET /a": { handler: () => "a" } } as never)).toThrow('Invalid route: "GET /a"');
    });

    test("パスの書き方の確認と、同じルートの 2 回登録は、app.routes() で app.get() と同じく行う", () => {
        const app = createApp();
        expect(() => app.routes(defineRoutes({ "GET /a/*/b": () => "x" }))).toThrow();
        app.routes(defineRoutes({ "GET /users/:id": () => "x" }));
        expect(() => app.routes(defineRoutes({ "GET /users/:name": () => "y" }))).toThrow("Duplicate route");
    });
});

describe("endpoint()", () => {
    const user = z.object({ name: z.string() });

    test("body のスキーマを通った値を c.valid(\"body\") で読める。通らなければ 400", async () => {
        const app = createApp();
        app.routes(
            defineRoutes({
                "POST /users": endpoint({ body: user }, (_, c) => ({ created: c.valid("body").name })),
            }),
        );
        const ok = await postJson(app, "/users", { name: "a" });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ created: "a" });
        expect((await postJson(app, "/users", { name: 1 })).status).toBe(400);
    });

    test("params と query のスキーマ。前置きのパラメーターも params のスキーマに入る", async () => {
        const app = createApp();
        app.routes(
            defineRoutes("/orgs/:orgId")({
                "GET /items/:id": endpoint(
                    { params: z.object({ orgId: z.string(), id: z.coerce.number() }), query: z.object({ q: z.string().optional() }) },
                    ({ orgId, id }, c) => ({ orgId, next: id + 1, q: c.valid("query").q ?? null }),
                ),
            }),
        );
        expect(await (await get(app, "/orgs/a/items/1?q=x")).json()).toEqual({ orgId: "a", next: 2, q: "x" });
        expect((await get(app, "/orgs/a/items/abc")).status).toBe(400);
    });

    test("通らなかったときは ValidationError(onError で受けられる)", async () => {
        const app = createApp();
        app.onError((err) => (err instanceof ValidationError ? `invalid ${err.target}` : "other"));
        app.routes(defineRoutes({ "POST /users": endpoint({ body: user }, () => "ok") }));
        expect(await (await postJson(app, "/users", {})).text()).toBe("invalid body");
    });

    test("ハンドラーがなければエラー", () => {
        expect(() => endpoint({ body: user }, undefined as never)).toThrow("Missing handler");
    });

    test("表の外で作って、表に置いてもよい", async () => {
        const create = endpoint({ body: user }, (_, c) => c.valid("body").name);
        const app = createApp();
        app.routes(defineRoutes({ "POST /a": create, "POST /b": create }));
        expect(await (await postJson(app, "/b", { name: "x" })).text()).toBe("x");
    });
});

describe("mergeRoutes()", () => {
    test("表を 1 つにする(順番は渡した順)", async () => {
        const a = defineRoutes("/a")({ "GET /": () => "a" });
        const b = defineRoutes("/b")({ "GET /": () => "b", "POST /": () => "b2" });
        const routes = mergeRoutes(a, b);
        expect(Object.keys(routes)).toEqual(["GET /a", "GET /b", "POST /b"]);

        const app = createApp();
        app.routes(routes);
        expect(await (await get(app, "/b", { method: "POST" })).text()).toBe("b2");
    });

    test("同じキーが 2 つあればエラー(黙って後ろが勝たない)", () => {
        const a = defineRoutes({ "GET /x": () => "a" });
        const b = defineRoutes({ "GET /x": () => "b" });
        expect(() => mergeRoutes(a, b)).toThrow('Duplicate route key: "GET /x"');
    });
});

describe("app.routes() の今までの書き方", () => {
    test("表を直接渡す形はそのまま動く", async () => {
        const app = createApp();
        app.routes({ "GET /hello": () => "hi", "GET /users/:id": ({ id }) => id });
        expect(await (await get(app, "/users/1")).text()).toBe("1");
    });

    test("ハンドラーでも endpoint でもない値はエラー", () => {
        const app = createApp();
        expect(() => app.routes({ "GET /a": "x" } as never)).toThrow('Invalid route: "GET /a"');
    });
});

describe("ルートごとのミドルウェア(use)", () => {
    // 通った順に名前を記録するミドルウェア
    const mark = (name: string, log: string[]): Middleware => {
        const mw: Middleware = async (_c, next) => {
            log.push(name);
            await next();
        };
        Object.defineProperty(mw, "name", { value: name });
        return mw;
    };

    test("順番: アプリの use → 表の use → ルートの use → スキーマの確認 → ハンドラー", async () => {
        const log: string[] = [];
        const app = createApp();
        app.use(mark("app", log));
        app.routes(
            defineRoutes("/admin", { use: [mark("table", log)] })({
                "POST /users": endpoint(
                    {
                        use: [mark("route", log)],
                        body: {
                            "~standard": {
                                version: 1,
                                vendor: "test",
                                validate: (value: unknown) => (log.push("validate"), { value }),
                            },
                        },
                    },
                    () => (log.push("handler"), "ok"),
                ),
            }),
        );
        expect(await (await postJson(app, "/admin/users", {})).text()).toBe("ok");
        expect(log).toEqual(["app", "table", "route", "validate", "handler"]);
    });

    test("付けたルートだけで動く(同じ表のほかのルートや、表の外のルートでは動かない)", async () => {
        const log: string[] = [];
        const app = createApp();
        app.routes(
            defineRoutes({
                "GET /a": endpoint({ use: [mark("a", log)] }, () => "a"),
                "GET /b": () => "b",
            }),
        );
        app.get("/c", () => "c");
        await get(app, "/b");
        await get(app, "/c");
        await get(app, "/missing");
        expect(log).toEqual([]);
        await get(app, "/a");
        expect(log).toEqual(["a"]);
    });

    test("表の use は、その表の全部のルートで動く", async () => {
        const log: string[] = [];
        const app = createApp();
        app.routes(
            defineRoutes("/admin", { use: [mark("auth", log)] })({
                "GET /": () => "top",
                "GET /x": endpoint({ use: [mark("x", log)] }, () => "x"),
            }),
        );
        app.get("/public", () => "p");
        await get(app, "/admin");
        await get(app, "/admin/x");
        await get(app, "/public");
        expect(log).toEqual(["auth", "auth", "x"]);
    });

    test("ミドルウェアが値を返したら、スキーマの確認(本文を読む)とハンドラーまで届かない", async () => {
        let read = false;
        const app = createApp();
        const deny: Middleware = (c) => {
            c.status(401);
            return "login";
        };
        app.routes(
            defineRoutes({
                "POST /x": endpoint(
                    {
                        use: [deny],
                        body: { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ((read = true), { value }) } },
                    },
                    () => "handler",
                ),
            }),
        );
        const res = await postJson(app, "/x", {});
        expect(res.status).toBe(401);
        expect(await res.text()).toBe("login");
        expect(read).toBe(false);
    });

    test("ミドルウェアの c.set() を、ハンドラーの c.get() で読める", async () => {
        const auth: Middleware<{ user: string }> = async (c, next) => {
            c.set("user", "alice");
            await next();
        };
        const app = createApp();
        app.routes(defineRoutes("", { use: [auth] })({ "GET /me": (_, c) => c.get("user") ?? "none" }));
        expect(await (await get(app, "/me")).text()).toBe("alice");
    });

    test("ミドルウェアの例外は onError に届く", async () => {
        const app = createApp();
        app.onError((err) => `caught: ${(err as Error).message}`);
        const boom: Middleware = () => {
            throw new Error("boom");
        };
        app.routes(defineRoutes({ "GET /x": endpoint({ use: [boom] }, () => "x") }));
        expect(await (await get(app, "/x")).text()).toBe("caught: boom");
    });

    test("use が配列でない、または関数でないものを含むとエラー", () => {
        expect(() => endpoint({ use: "x" as never }, () => "x")).toThrow("Invalid middleware");
        expect(() => endpoint({ use: [1] as never }, () => "x")).toThrow("Invalid middleware");
        expect(() => defineRoutes("/a", { use: [null] as never })).toThrow("Invalid middleware");
    });

    test("開発モード: タイムラインとダッシュボードのルートの行に出る", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        let names: string[] = [];
        app.use(async function outer(c, next) {
            await next();
            names = c.timings.map((t) => t.name);
        });
        const requireUser: Middleware = async (_c, next) => {
            await next();
        };
        Object.defineProperty(requireUser, "name", { value: "requireUser" });
        app.routes(defineRoutes({ "GET /x": endpoint({ use: [requireUser] }, () => "x") }));
        const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
        await app.fetch(new Request("http://localhost:3927/x", { headers: { host: "localhost:3927" } }), local);
        expect(names).toContain("requireUser");

        const rows = await (await app.fetch(new Request("http://localhost:3927/_senri/api/routes", { headers: { host: "localhost:3927" } }), local)).json();
        const row = rows.find((r: { path: string }) => r.path === "/x");
        expect(row.middlewares).toContainEqual({ name: "requireUser", applies: "yes" });
    });
});
