import { describe, expect, test } from "bun:test";
import { createApp, createRouter } from "../src/index.ts";

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
        expect(app.routeList()).toEqual([
            { method: "GET", path: "/users/:id" },
            { method: "POST", path: "/users/:id/follow" },
            { method: "GET", path: "/users/:id/posts/:postId" },
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

        expect(() => app.route(a)).toThrow("すでに登録されています");
    });
});
