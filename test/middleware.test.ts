import { describe, expect, test } from "bun:test";
import { createApp, logger, type Middleware } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

describe("c.path", () => {
    test("正規化・デコード済みのパスが入っている", async () => {
        const app = createApp();
        const seen: string[] = [];
        app.use((c, next) => {
            seen.push(c.path);
            return next();
        });
        app.get("/admin", () => "ok");
        app.get("/u/:name", () => "ok");

        await app.fetch(req("//admin/"));
        await app.fetch(req("/u/山田"));

        expect(seen).toEqual(["/admin", "/u/山田"]);
    });

    test("c.path で書いた認証は //admin や /%61dmin で素通りできない", async () => {
        const app = createApp();
        app.use((c, next) => {
            if (c.path.startsWith("/admin") && c.req.headers.get("authorization") !== "secret") {
                c.status(401);
                return "ログインしてね";
            }
            return next();
        });
        app.get("/admin", () => "管理画面");

        for (const path of ["/admin", "//admin", "/%61dmin", "/admin/"]) {
            const res = await app.fetch(req(path));
            expect(res.status).toBe(401);
        }
    });

    test("エンコードが不正なら、ミドルウェアで読んだ時点で 400 になる", async () => {
        const app = createApp();
        app.use((c, next) => {
            void c.path;
            return next();
        });

        const res = await app.fetch(req("/%E0%A4%A"));

        expect(res.status).toBe(400);
    });
});

describe("c.set / c.get", () => {
    test("ミドルウェアで入れた値をハンドラーで読める", async () => {
        const app = createApp<{ user: string }>();
        app.use((c, next) => {
            c.set("user", "yahari");
            return next();
        });
        app.get("/me", (_, c) => c.get("user") ?? "anonymous");

        const res = await app.fetch(req("/me"));

        expect(await res.text()).toBe("yahari");
    });

    test("入れていないキーは undefined", async () => {
        const app = createApp<{ user: string }>();
        app.get("/me", (_, c) => c.get("user") ?? "anonymous");

        const res = await app.fetch(req("/me"));

        expect(await res.text()).toBe("anonymous");
    });
});

describe("ミドルウェアの名前", () => {
    test("関数の名前が使われ、無名なら anonymous#番号 になる", () => {
        const app = createApp();
        const auth: Middleware = (_c, next) => next();
        app.use(logger({ color: false }));
        app.use(auth);
        app.use("/admin", (_c, next) => next());

        expect(app.middlewareList()).toEqual([
            { name: "logger", path: null, anonymous: false },
            { name: "auth", path: null, anonymous: false },
            { name: "anonymous#3", path: "/admin", anonymous: true },
        ]);
    });
});

describe("c.route と c.params", () => {
    test("ミドルウェアの中で、next() の前からマッチしたパターンとパラメーターが読める", async () => {
        const app = createApp();
        let seen: unknown;
        app.use((c, next) => {
            seen = { route: c.route, params: c.params };
            return next();
        });
        app.get("/users/:id", ({ id }) => id);

        await app.fetch(req("/users/42"));

        expect(seen).toEqual({ route: "/users/:id", params: { id: "42" } });
    });

    test("見つからないときは route が undefined、params が空", async () => {
        const app = createApp();
        let seen: unknown;
        app.use((c, next) => {
            seen = { route: c.route, params: c.params };
            return next();
        });

        const res = await app.fetch(req("/nope"));

        expect(res.status).toBe(404);
        expect(seen).toEqual({ route: undefined, params: {} });
    });

    test("HEAD で GET にフォールバックしたときは GET のパターン", async () => {
        const app = createApp();
        let route: string | undefined;
        app.use((c, next) => {
            route = c.route;
            return next();
        });
        app.get("/hello", () => "hi");

        await app.fetch(req("/hello", { method: "HEAD" }));

        expect(route).toBe("/hello");
    });

    test("エンコードが不正でもミドルウェアは動き、結果は 400", async () => {
        const app = createApp();
        let ran = false;
        app.use((c, next) => {
            ran = true;
            expect(c.route).toBeUndefined();
            return next();
        });
        app.get("/u/:id", ({ id }) => id);

        const res = await app.fetch(req("/u/%E0%A4%A"));

        expect(ran).toBe(true);
        expect(res.status).toBe(400);
    });
});

describe("app.use(path, mw)", () => {
    test("そのパスと、その下のパスだけで動く", async () => {
        const app = createApp();
        const seen: string[] = [];
        app.use("/admin", (c, next) => {
            seen.push(c.path);
            return next();
        });
        for (const path of ["/admin", "/admin/users", "/administrator", "/other"]) {
            app.get(path, () => "ok");
        }

        for (const path of ["/admin", "/admin/users", "/administrator", "/other", "//admin", "/%61dmin/users"]) {
            await app.fetch(req(path));
        }

        expect(seen).toEqual(["/admin", "/admin/users", "/admin", "/admin/users"]);
    });

    test("全体のミドルウェアと登録順どおりに並ぶ", async () => {
        const app = createApp();
        const order: string[] = [];
        app.use(async (_c, next) => {
            order.push("global-1");
            await next();
        });
        app.use("/admin", async (_c, next) => {
            order.push("admin");
            await next();
        });
        app.use(async (_c, next) => {
            order.push("global-2");
            await next();
        });
        app.get("/admin", () => "ok");

        await app.fetch(req("/admin"));

        expect(order).toEqual(["global-1", "admin", "global-2"]);
    });
});

describe('app.use("/x/*", mw)', () => {
    // 認証のミドルウェアが付いたアプリ。* を文字として比べていたころは、認証が動かず 200 で本文が返っていた
    function guarded(path: string) {
        const app = createApp();
        let ran = 0;
        app.use(path, (c, next) => {
            ran++;
            if (c.req.headers.get("authorization") !== "secret") {
                c.status(401);
                return "ログインしてね";
            }
            return next();
        });
        for (const route of ["/admin", "/admin/secret", "/admin/a/b", "/administrator", "/other"]) {
            app.get(route, () => "秘密のデータ");
        }
        return { app, ran: () => ran };
    }

    test("認証が動く: 認証なしの /admin/secret は 401", async () => {
        const { app, ran } = guarded("/admin/*");

        const res = await app.fetch(req("/admin/secret"));

        expect(res.status).toBe(401);
        expect(await res.text()).toBe("ログインしてね");
        expect(ran()).toBe(1);
    });

    test("認証を通れば、ハンドラーまで届く", async () => {
        const { app } = guarded("/admin/*");

        const res = await app.fetch(req("/admin/secret", { headers: { authorization: "secret" } }));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("秘密のデータ");
    });

    test.each([
        ["/admin", 401],
        ["/admin/", 401],
        ["//admin", 401],
        ["/%61dmin/secret", 401],
        ["/admin/secret", 401],
        ["/admin/a/b", 401],
        ["/administrator", 200],
        ["/other", 200],
    ])("%s は %d(/admin と同じ)", async (path, status) => {
        expect((await guarded("/admin/*").app.fetch(req(path))).status).toBe(status);
        expect((await guarded("/admin").app.fetch(req(path))).status).toBe(status);
    });

    test("末尾のスラッシュがあっても同じ", async () => {
        expect((await guarded("/admin/*/").app.fetch(req("/admin/secret"))).status).toBe(401);
    });

    test('"/*" は "/" と同じで、すべてのパスで動く', async () => {
        for (const path of ["/*", "/"]) {
            const { app } = guarded(path);
            for (const target of ["/admin", "/other", "/missing/path"]) {
                expect((await app.fetch(req(target))).status).toBe(401);
            }
        }
    });

    test("プレフィックスのパラメーターにも使える", async () => {
        const app = createApp();
        const seen: string[] = [];
        app.use("/users/:id/*", (c, next) => {
            seen.push(c.path);
            return next();
        });
        app.get("/users/:id", () => "user");
        app.get("/users/:id/posts", () => "posts");
        app.get("/users", () => "list");

        for (const path of ["/users", "/users/1", "/users/1/posts"]) await app.fetch(req(path));

        expect(seen).toEqual(["/users/1", "/users/1/posts"]);
    });

    test("middlewareList には、取ったあとのパスが出る", () => {
        const app = createApp();
        app.use("/admin/*", function auth(_c, next) {
            return next();
        });
        app.use("/*", function all(_c, next) {
            return next();
        });

        expect(app.middlewareList()).toEqual([
            { name: "auth", path: "/admin", anonymous: false },
            { name: "all", path: "/", anonymous: false },
        ]);
    });

    test.each(["/a/*/c", "/*/a", "/a/*/*", "/files/*.js", "/*.js", "/admin*", "/*splat", "/a/**", "/:id*"])("%s は登録時のエラー", (path) => {
        let error: (Error & { code?: string }) | undefined;
        try {
            createApp().use(path, (_c, next) => next());
        } catch (err) {
            error = err as Error & { code?: string };
        }

        expect(error?.code).toBe("wildcard_position");
        expect(error?.message).toBe(`"*" must be the whole last segment: ${path}`);
    });

    test("開発モードの登録時のエラーには、日本語の説明が付く", () => {
        const app = createApp({ dev: devtools() });

        expect(() => app.use("/a/*/c", (_c, next) => next())).toThrow("最後のセグメント全体");
    });
});

describe("next() の呼び方", () => {
    test("何も返さず next() 済みなら、下流のレスポンスを使う", async () => {
        const app = createApp();
        app.use(async (_c, next) => {
            await next();
        });
        app.get("/x", () => "下流");

        const res = await app.fetch(req("/x"));

        expect(await res.text()).toBe("下流");
    });

    test("next() を2回呼ぶとエラーになり、ハンドラーは1回しか動かない", async () => {
        const app = createApp({ dev: devtools() });
        let calls = 0;
        app.use(async (_c, next) => {
            await next();
            return next();
        });
        app.get("/x", () => `call ${++calls}`);

        const res = await app.fetch(req("/x"));

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("next() が2回呼ばれました");
        expect(calls).toBe(1);
    });

    test("next() を await し忘れても、下流のレスポンスを待って使う", async () => {
        const app = createApp();
        app.use((_c, next) => {
            next();
        });
        app.get("/x", async () => {
            await new Promise((r) => setTimeout(r, 10));
            return "遅れて届く";
        });

        const res = await app.fetch(req("/x"));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("遅れて届く");
    });
});
