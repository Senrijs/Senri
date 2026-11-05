import { describe, expect, test } from "bun:test";
import { createApp, createRouter, type Context, type Next } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("createRouter と app.route", () => {
    test("プレフィックスを付けて登録され、プレフィックスのパラメーターも受け取れる", async () => {
        const users = createRouter("/users/:id");
        users.get("/", ({ id }) => `user ${id}`);
        users.get("/posts/:postId", ({ id, postId }) => `${id} の投稿 ${postId}`);
        users.post("/follow", ({ id }) => `follow ${id}`);
        const app = createApp();
        app.route(users);

        expect(await (await app.fetch(req("/users/7"))).text()).toBe("user 7");
        expect(await (await app.fetch(req("/users/7/posts/9"))).text()).toBe("7 の投稿 9");
        expect(await (await app.fetch(req("/users/7/follow", { method: "POST" }))).text()).toBe("follow 7");
        // routeList は登録順(優先順位の順に並べるのは、開発モードの一覧だけ)
        expect(app.routeList()).toEqual([
            { method: "GET", path: "/users/:id" },
            { method: "GET", path: "/users/:id/posts/:postId" },
            { method: "POST", path: "/users/:id/follow" },
        ]);
    });

    test("グループの use はグループの中だけで動く", async () => {
        const seen: string[] = [];
        const admin = createRouter("/admin");
        admin.use(async function guard(c, next) {
            seen.push(c.path);
            await next();
        });
        admin.get("/users", () => "users");
        const app = createApp();
        app.route(admin);
        app.get("/public", () => "public");

        await app.fetch(req("/admin/users"));
        await app.fetch(req("/public"));

        expect(seen).toEqual(["/admin/users"]);
    });

    test("パラメーターを含むパスのミドルウェアも、そのパスで動く", async () => {
        const seen: string[] = [];
        const app = createApp();
        app.use("/users/:id", async (c, next) => {
            seen.push(c.path);
            await next();
        });
        app.get("/users/:id/posts", () => "posts");
        app.get("/users", () => "list");

        await app.fetch(req("/users/7/posts"));
        await app.fetch(req("/users"));

        expect(seen).toEqual(["/users/7/posts"]);
    });

    test("ルーターの中にルーターをつなげる", async () => {
        const posts = createRouter("/posts");
        posts.get("/:postId", ({ postId }) => `post ${postId}`);
        const users = createRouter("/users/:id");
        users.route(posts);
        const app = createApp();
        app.route(users);

        expect(await (await app.fetch(req("/users/1/posts/2"))).text()).toBe("post 2");
    });

    test("重複の確認はグループをまたいでも効く", () => {
        const a = createRouter("/x");
        a.get("/", () => "a");
        const app = createApp();
        app.get("/x", () => "x");

        expect(() => app.route(a)).toThrow("Duplicate route");
    });
});

describe("app.route(prefix, app)", () => {
    test("別の app をプレフィックス付きでつなぐ", async () => {
        const api = createApp();
        api.get("/users/:id", ({ id }) => `user ${id}`);
        api.on("QUERY", "/search", () => "q");
        const app = createApp();
        app.route("/api/v1", api);

        expect(await (await app.fetch(req("/api/v1/users/3"))).text()).toBe("user 3");
        expect(app.routeList()).toEqual([
            { method: "GET", path: "/api/v1/users/:id" },
            { method: "QUERY", path: "/api/v1/search" },
        ]);
    });

    test("プレフィックスのパラメーターも実行時には受け取れる", async () => {
        const posts = createApp();
        posts.get("/posts", (_, c) => `posts of ${c.params.id}`);
        const app = createApp();
        app.route("/users/:id", posts);

        expect(await (await app.fetch(req("/users/5/posts"))).text()).toBe("posts of 5");
    });

    test("つないだ app のミドルウェアは、プレフィックスの下だけで動く", async () => {
        const seen: string[] = [];
        const admin = createApp();
        admin.use(async function guard(c, next) {
            seen.push(c.path);
            await next();
        });
        admin.use("/secret", async function deep(c, next) {
            seen.push(`deep ${c.path}`);
            await next();
        });
        admin.get("/", () => "top");
        admin.get("/secret", () => "s");
        const app = createApp();
        app.route("/admin", admin);
        app.get("/", () => "home");

        await app.fetch(req("/"));
        await app.fetch(req("/admin"));
        await app.fetch(req("/admin/secret"));

        expect(seen).toEqual(["/admin", "/admin/secret", "deep /admin/secret"]);
        expect(app.middlewareList()).toEqual([
            { name: "guard", path: "/admin", anonymous: false },
            { name: "deep", path: "/admin/secret", anonymous: false },
        ]);
    });

    test('use("/x/*") は use("/x") と同じ(createRouter とつないだ app)', async () => {
        const guard = (seen: string[]) => (c: Context, next: Next) => {
            seen.push(c.path);
            return next();
        };

        const viaRouter: string[] = [];
        const router = createRouter("/r/:id");
        router.use("/x/*", guard(viaRouter));
        router.get("/x", () => "x");
        router.get("/x/y", () => "y");
        router.get("/z", () => "z");

        const viaChild: string[] = [];
        const child = createApp();
        child.use("/x/*", guard(viaChild));
        child.get("/x", () => "x");
        child.get("/x/y", () => "y");
        child.get("/z", () => "z");

        const app = createApp();
        app.route(router);
        app.route("/c", child);

        for (const base of ["/r/1", "/c"]) {
            for (const path of ["/x", "/x/y", "/z"]) await app.fetch(req(base + path));
        }

        expect(viaRouter).toEqual(["/r/1/x", "/r/1/x/y"]);
        expect(viaChild).toEqual(["/c/x", "/c/x/y"]);
    });

    test('createRouter の use("/*") は、プレフィックスの下だけで動く', async () => {
        const seen: string[] = [];
        const router = createRouter("/admin");
        router.use("/*", (c, next) => {
            seen.push(c.path);
            return next();
        });
        router.get("/", () => "top");
        const app = createApp();
        app.route(router);
        app.get("/other", () => "other");

        await app.fetch(req("/admin"));
        await app.fetch(req("/other"));

        expect(seen).toEqual(["/admin"]);
    });

    test("createRouter の use の途中の * は、app.route のときにエラー", () => {
        const router = createRouter("/r");
        router.use("/a/*/c", (_c, next) => next());

        expect(() => createApp().route(router)).toThrow('"*" must be the whole last segment: /r/a/*/c');
    });

    test("エラーと 404 は、つなぐ側(親)の onError / notFound を使う", async () => {
        const child = createApp();
        child.onError(() => "child error");
        child.notFound(() => "child 404");
        child.get("/boom", () => {
            throw new Error("x");
        });
        const app = createApp();
        app.onError((_, c) => c.text("parent error", 500));
        app.notFound(() => "parent 404");
        app.route("/c", child);

        expect(await (await app.fetch(req("/c/boom"))).text()).toBe("parent error");
        expect(await (await app.fetch(req("/c/nope"))).text()).toBe("parent 404");
    });

    test("プレフィックスが文字列でなければエラー", () => {
        const app = createApp();
        // @ts-expect-error
        expect(() => app.route(createApp())).toThrow("createRouter");
    });
});

