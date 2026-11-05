import { describe, expect, spyOn, test } from "bun:test";
import { cors, createApp, createRouter, showRoutes, type App, type StandardSchemaV1 } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

// どのルートに当たって、どんなパラメーターを受け取ったか
const report = (params: Record<string, string>, c: { route: string | undefined }) => ({ route: c.route, params });

async function hit(app: App, path: string, init?: RequestInit) {
    const res = await app.fetch(req(path, init));
    return res.status === 200 ? await res.json() : res.status;
}

function withRoutes(...paths: string[]) {
    const app = createApp();
    for (const path of paths) app.get(path, report);
    return app;
}

describe("当たる範囲と受け取る値", () => {
    test.each([
        ["/files", ""],
        ["/files/", ""],
        ["//files", ""],
        ["/files/a", "a"],
        ["/files/a/", "a"],
        ["/files//a", "a"],
        ["/files/a/b", "a/b"],
        ["/files/a/b/c", "a/b/c"],
        ["/files/a?x=1", "a"],
    ])("%s の値は %j", async (path, value) => {
        expect(await hit(withRoutes("/files/*"), path)).toEqual({ route: "/files/*", params: { "*": value } });
    });

    test.each(["/filesx", "/file", "/other", "/"])("%s には当たらない", async (path) => {
        expect(await hit(withRoutes("/files/*"), path)).toBe(404);
    });

    test("/* は / にも、すべてのパスにも当たる", async () => {
        const app = withRoutes("/*");

        expect(await hit(app, "/")).toEqual({ route: "/*", params: { "*": "" } });
        expect(await hit(app, "/a")).toEqual({ route: "/*", params: { "*": "a" } });
        expect(await hit(app, "/a/b")).toEqual({ route: "/*", params: { "*": "a/b" } });
    });

    test("パラメーターと一緒に使える", async () => {
        const app = withRoutes("/users/:id/*");

        expect(await hit(app, "/users/1")).toEqual({ route: "/users/:id/*", params: { id: "1", "*": "" } });
        expect(await hit(app, "/users/1/a/b")).toEqual({ route: "/users/:id/*", params: { id: "1", "*": "a/b" } });
        expect(await hit(app, "/users")).toBe(404);
    });

    test("文字の * を送っても、値の * になる", async () => {
        expect(await hit(withRoutes("/files/*"), "/files/*")).toEqual({ route: "/files/*", params: { "*": "*" } });
    });

    test("c.params でも読める", async () => {
        const app = createApp();
        app.get("/files/*", (_, c) => c.params);

        expect(await (await app.fetch(req("/files/a/b"))).json()).toEqual({ "*": "a/b" });
    });
});

describe("デコード", () => {
    test("セグメントごとに1回だけデコードする", async () => {
        const app = withRoutes("/files/*");
        const value = async (path: string) => (await hit(app, path)).params["*"];

        expect(await value("/files/%E3%81%82/%E3%81%84")).toBe("あ/い");
        expect(await value("/files/a%20b")).toBe("a b");
        // 2回デコードしない
        expect(await value("/files/%252F")).toBe("%2F");
        expect(await value("/files/%2541")).toBe("%41");
    });

    test.each(["/files/a%2Fb", "/files/%2f", "/files/%E0%A4%A"])("%s はルートに届く前に 400", async (path) => {
        expect(await hit(withRoutes("/files/*"), path)).toBe(400);
    });

    test(". や .. のセグメントは解決される。エンコードしてあっても、外には出ない", async () => {
        const app = withRoutes("/files/*", "/secret");

        expect((await hit(app, "/files/a/../b")).params["*"]).toBe("b");
        expect((await hit(app, "/files/a/%2e%2e/b")).params["*"]).toBe("b");
        expect((await hit(app, "/files/../secret")).route).toBe("/secret");
    });

    // ファイルのパスに使わないよう、JSDoc と README で注意している値。拒否はしない
    test("\\ と NUL は値に入る", async () => {
        const app = withRoutes("/files/*");

        expect((await hit(app, "/files/..%5C..%5Csecret")).params["*"]).toBe("..\\..\\secret");
        expect((await hit(app, "/files/a%00b")).params["*"]).toBe("a\0b");
    });
});

describe("優先順位", () => {
    test.each([
        ["/p/*", "/p/:id", "/p/x"],
        ["/p/x", "/p/:id", "/p/*"],
        ["/p/:id", "/p/*", "/p/x"],
    ])("登録順によらない: %s, %s, %s", async (first, second, third) => {
        const app = withRoutes(first, second, third);

        expect((await hit(app, "/p/x")).route).toBe("/p/x");
        expect((await hit(app, "/p/y")).route).toBe("/p/:id");
        expect((await hit(app, "/p/y/z")).route).toBe("/p/*");
        expect((await hit(app, "/p")).route).toBe("/p/*");
    });

    test("/files があれば、/files/* より優先", async () => {
        expect((await hit(withRoutes("/files/*", "/files"), "/files")).route).toBe("/files");
    });

    test("見つからなければ戻って試す(バックトラック)", async () => {
        const app = withRoutes("/a/b/c", "/a/:x/d", "/a/*", "/*", "/:only");

        expect((await hit(app, "/a/b/c")).route).toBe("/a/b/c");
        expect((await hit(app, "/a/b/d")).route).toBe("/a/:x/d");
        expect(await hit(app, "/a/b/e")).toEqual({ route: "/a/*", params: { "*": "b/e" } });
        expect(await hit(app, "/a")).toEqual({ route: "/a/*", params: { "*": "" } });
        expect((await hit(app, "/z")).route).toBe("/:only");
        expect(await hit(app, "/z/y")).toEqual({ route: "/*", params: { "*": "z/y" } });
        expect((await hit(app, "/")).route).toBe("/*");
    });

    test("バックトラックしても、戻った枝のパラメーターは残らない", async () => {
        expect(await hit(withRoutes("/a/:x/d", "/a/*"), "/a/b/e")).toEqual({ route: "/a/*", params: { "*": "b/e" } });
    });

    test("メソッドが合うものが先: GET には GET の * が、ALL の静的より優先(今の規則と同じ)", async () => {
        const app = createApp();
        app.get("/files/*", () => "wild");
        app.all("/files/x", () => "all");

        expect(await (await app.fetch(req("/files/x"))).text()).toBe("wild");
        expect(await (await app.fetch(req("/files/x", { method: "POST" }))).text()).toBe("all");
    });
});

describe("405 と OPTIONS には数えない", () => {
    test.each(["POST", "PUT", "DELETE", "OPTIONS"])("GET /files/* だけのパスに %s は 404", async (method) => {
        const res = await withRoutes("/files/*").fetch(req("/files/a", { method }));

        expect(res.status).toBe(404);
        expect(res.headers.get("allow")).toBeNull();
    });

    test("GET /* があっても、ルートのない POST は 404", async () => {
        expect((await withRoutes("/*").fetch(req("/missing", { method: "POST" }))).status).toBe(404);
    });

    test("静的やパラメーターのルートがあれば 405 で、Allow にはそのルートのメソッドだけ", async () => {
        const app = createApp();
        app.get("/files/*", report);
        app.post("/files/upload", () => "uploaded");
        app.put("/files/:id", () => "put");

        const upload = await app.fetch(req("/files/upload", { method: "DELETE" }));
        expect(upload.status).toBe(405);
        expect(upload.headers.get("allow")).toBe("POST, PUT, OPTIONS");

        const options = await app.fetch(req("/files/upload", { method: "OPTIONS" }));
        expect(options.status).toBe(204);
        expect(options.headers.get("allow")).toBe("POST, PUT, OPTIONS");

        expect((await app.fetch(req("/files/a/b", { method: "DELETE" }))).status).toBe(404);
    });

    test("そのメソッドを登録すれば答えられる", async () => {
        const app = createApp();
        app.get("/files/*", () => "get");
        app.post("/files/*", () => "post");
        app.options("/files/*", () => "options");
        app.all("/any/*", () => "all");

        expect(await (await app.fetch(req("/files/a", { method: "POST" }))).text()).toBe("post");
        expect(await (await app.fetch(req("/files/a", { method: "OPTIONS" }))).text()).toBe("options");
        expect(await (await app.fetch(req("/any/a", { method: "DELETE" }))).text()).toBe("all");
    });

    test("HEAD は GET の * を使い、本文を捨てる", async () => {
        const app = createApp();
        app.get("/files/*", () => "body");

        const res = await app.fetch(req("/files/a", { method: "HEAD" }));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("");
    });

    test("cors() のプリフライトは、ミドルウェアが答えるので 404 にならない", async () => {
        const app = createApp();
        app.use(cors({ origin: "https://example.com" }));
        app.get("/files/*", () => "x");

        const res = await app.fetch(
            req("/files/a", { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "GET" } }),
        );

        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
    });

    test("POST が 404 になるとき、app.notFound のハンドラーに回る", async () => {
        const app = withRoutes("/files/*");
        app.notFound(() => "ありません");

        expect(await (await app.fetch(req("/files/a", { method: "POST" }))).text()).toBe("ありません");
    });
});

describe("登録時のエラー", () => {
    test.each(["/a/*/c", "/*/a", "/a/*/*", "/files/*.js", "/*.js", "/files*", "/*splat", "/a/**", "/:id*", "/a*b"])("%s は wildcard_position", (path) => {
        let error: (Error & { code?: string }) | undefined;
        try {
            createApp().get(path, () => "x");
        } catch (err) {
            error = err as Error & { code?: string };
        }

        expect(error?.code).toBe("wildcard_position");
        expect(error?.message).toBe(`"*" must be the whole last segment: ${path}`);
    });

    test("app.on と app.routes でも同じ", () => {
        expect(() => createApp().on("GET", "/a/*/c", () => "x")).toThrow("whole last segment");
        expect(() => createApp().routes({ "GET /a/*/c": () => "x" })).toThrow("whole last segment");
    });

    test("createRouter の途中の * は、app.route のときにエラー", () => {
        const router = createRouter("/r/*");
        router.get("/x", () => "x");

        expect(() => createApp().route(router)).toThrow('"*" must be the whole last segment: /r/*/x');
    });
});

describe("重複", () => {
    function second(first: string, next: string, method: "get" | "post" = "get") {
        const app = createApp();
        app.get(first, () => "1");
        app[method](next, () => "2");
    }

    test.each([
        ["/files/*", "/files/*"],
        ["/files/*", "/files/*/"],
        ["/files/*", "//files//*"],
        ["/u/:a/*", "/u/:b/*"],
    ])("%s と %s は route_duplicate", (first, next) => {
        let error: (Error & { code?: string }) | undefined;
        try {
            second(first, next);
        } catch (err) {
            error = err as Error & { code?: string };
        }

        expect(error?.code).toBe("route_duplicate");
    });

    test("メソッドや形が違えば登録できる", () => {
        expect(() => second("/files/*", "/files/*", "post")).not.toThrow();
        expect(() => second("/files/*", "/files/:id")).not.toThrow();
        expect(() => second("/files/*", "/files")).not.toThrow();
        expect(() => second("/files/*", "/files/x/*")).not.toThrow();
    });
});

describe("グループ", () => {
    test("createRouter: プレフィックスのパラメーターと一緒に受け取れる", async () => {
        const router = createRouter("/r/:id");
        router.get("/*", ({ id, "*": rest }) => ({ id, rest }));
        const app = createApp();
        app.route(router);

        expect(await (await app.fetch(req("/r/1/a/b"))).json()).toEqual({ id: "1", rest: "a/b" });
        expect(await (await app.fetch(req("/r/1"))).json()).toEqual({ id: "1", rest: "" });
    });

    test("createRouter: パスに * だけでも書ける", async () => {
        const router = createRouter("/s");
        router.get("*", ({ "*": rest }) => ({ rest }));
        const app = createApp();
        app.route(router);

        expect(await (await app.fetch(req("/s/a"))).json()).toEqual({ rest: "a" });
    });

    test("app.route(prefix, app): プレフィックスの下だけに当たる", async () => {
        const child = createApp();
        child.get("/*", ({ "*": rest }) => ({ rest }));
        const app = createApp();
        app.route("/c", child);

        expect(await (await app.fetch(req("/c"))).json()).toEqual({ rest: "" });
        expect(await (await app.fetch(req("/c/a/b"))).json()).toEqual({ rest: "a/b" });
        expect((await app.fetch(req("/other"))).status).toBe(404);
    });
});

describe("ほかの機能と一緒に", () => {
    test('ミドルウェアの use("/files/*") は、/files/* のルートの前に動く', async () => {
        const app = createApp();
        app.use("/files/*", (c, next) => (c.req.headers.get("authorization") === "secret" ? next() : c.text("401", 401)));
        app.get("/files/*", ({ "*": rest }) => rest);

        for (const path of ["/files", "/files/a/b"]) {
            expect((await app.fetch(req(path))).status).toBe(401);
        }
        expect(await (await app.fetch(req("/files/a/b", { headers: { authorization: "secret" } }))).text()).toBe("a/b");
    });

    test("c.route はミドルウェアから読める", async () => {
        const app = createApp();
        let seen: { route: string | undefined; params: Record<string, string> } | undefined;
        app.use((c, next) => {
            seen = { route: c.route, params: c.params };
            return next();
        });
        app.get("/files/*", () => "x");

        await app.fetch(req("/files/a"));

        expect(seen).toEqual({ route: "/files/*", params: { "*": "a" } });
    });

    test("スキーマの params に * も渡る", async () => {
        const schema: StandardSchemaV1<unknown, { "*": string }> = {
            "~standard": {
                version: 1,
                vendor: "test",
                validate: (value) => {
                    const rest = (value as { "*": string })["*"];
                    return rest.endsWith(".png") ? { value: { "*": rest } } : { issues: [{ message: "png だけ", path: ["*"] }] };
                },
            },
        };
        const app = createApp();
        app.get("/img/*", { params: schema }, ({ "*": rest }) => rest);

        expect(await (await app.fetch(req("/img/a/b.png"))).text()).toBe("a/b.png");
        expect((await app.fetch(req("/img/a.txt"))).status).toBe(400);
    });

    test("c.notFound() は /files/* のルートからも呼べる", async () => {
        const app = createApp();
        app.get("/files/*", (_, c) => c.notFound());

        expect((await app.fetch(req("/files/a"))).status).toBe(404);
    });

    test("showRoutes は * にも色を付ける", () => {
        const log = spyOn(console, "log").mockImplementation(() => {});
        try {
            showRoutes(withRoutes("/files/*"), "http://localhost");

            expect(log.mock.calls.flat().join("\n")).toContain("/files/\x1b[36m*\x1b[0m");
        } finally {
            log.mockRestore();
        }
    });
});
