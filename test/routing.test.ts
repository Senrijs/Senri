import { describe, expect, test } from "bun:test";
import { createApp, HttpError } from "../src/index.ts";
import { splitPath } from "../src/router.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

describe("ルートの優先順位", () => {
    // 登録順をいろいろ変えても、静的なセグメントが優先されること
    const orders = [
        ["/users/:id", "/users", "/users/me"],
        ["/users", "/users/:id", "/users/me"],
        ["/users/me", "/users", "/users/:id"],
        ["/users/:id", "/users/:id/posts/:postId", "/users/me"],
    ];

    for (const order of orders) {
        test(`登録順 ${order.join(" → ")} でも /users/me は静的ルート`, async () => {
            const app = createApp();
            for (const path of order) {
                app.get(path, () => path);
            }

            const res = await app.fetch(req("/users/me"));

            expect(await res.text()).toBe("/users/me");
        });
    }

    test("前のセグメントが静的なほうが優先される", async () => {
        const app = createApp();
        app.get("/:a/b", () => "param-static");
        app.get("/a/:b", () => "static-param");

        const res = await app.fetch(req("/a/b"));

        expect(await res.text()).toBe("static-param");
    });
});

describe("登録のチェック", () => {
    test("同じメソッド + パスを2回登録するとエラー", () => {
        const app = createApp();
        app.get("/users", () => "1");

        expect(() => app.get("/users", () => "2")).toThrow("GET /users はすでに登録されています");
    });

    test("末尾スラッシュだけ違うものも同じパス", () => {
        const app = createApp();
        app.get("/users", () => "1");

        expect(() => app.get("/users/", () => "2")).toThrow("すでに登録されています");
    });

    test("パラメーター名だけ違うものも同じパス", () => {
        const app = createApp();
        app.get("/users/:id", () => "1");

        expect(() => app.get("/users/:name", () => "2")).toThrow(
            "GET /users/:name は、登録済みの GET /users/:id と同じパスです",
        );
    });

    test("メソッドが違えば同じパスでも登録できる", () => {
        const app = createApp();
        app.get("/users", () => "1");

        expect(() => app.post("/users", () => "2")).not.toThrow();
    });

    test("1つのパターンで同じパラメーター名を2回使うとエラー", () => {
        const app = createApp();

        expect(() => app.get("/a/:id/b/:id", () => "x")).toThrow('パラメーター名 "id" が2回使われています');
    });
});

describe("put / patch / all", () => {
    test("put と patch で登録できる", async () => {
        const app = createApp();
        app.put("/x/:id", ({ id }) => `put ${id}`);
        app.patch("/x/:id", ({ id }) => `patch ${id}`);

        expect(await (await app.fetch(req("/x/1", { method: "PUT" }))).text()).toBe("put 1");
        expect(await (await app.fetch(req("/x/1", { method: "PATCH" }))).text()).toBe("patch 1");
    });

    test("all はどのメソッドでも動く", async () => {
        const app = createApp();
        app.all("/any", (_, c) => c.req.method);

        for (const method of ["GET", "POST", "DELETE", "PUT"]) {
            expect(await (await app.fetch(req("/any", { method }))).text()).toBe(method);
        }
    });

    test("メソッドが合うルートがあれば、all より優先", async () => {
        const app = createApp();
        app.all("/x", () => "all");
        app.get("/x", () => "get");

        expect(await (await app.fetch(req("/x"))).text()).toBe("get");
        expect(await (await app.fetch(req("/x", { method: "POST" }))).text()).toBe("all");
    });
});

describe("HEAD と OPTIONS", () => {
    test("HEAD は GET ルートで処理して、ボディを捨てる", async () => {
        const app = createApp();
        app.get("/hello", () => ({ hi: 1 }));

        const res = await app.fetch(req("/hello", { method: "HEAD" }));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/json");
        expect(await res.text()).toBe("");
    });

    test("HEAD のルートを自分で書いたら、そちらが使われる", async () => {
        const app = createApp();
        app.get("/x", () => "GET");
        app.routes({ "HEAD /x": (_, c) => c.header("x-head", "1").text("") });

        const res = await app.fetch(req("/x", { method: "HEAD" }));

        expect(res.headers.get("x-head")).toBe("1");
    });

    test("OPTIONS は 204 と Allow ヘッダーを返す", async () => {
        const app = createApp();
        app.get("/hello", () => "hi");
        app.post("/hello", () => "posted");

        const res = await app.fetch(req("/hello", { method: "OPTIONS" }));

        expect(res.status).toBe(204);
        expect(res.headers.get("allow")).toBe("GET, HEAD, POST, OPTIONS");
    });

    test("ルートがないパスへの OPTIONS は 404", async () => {
        const app = createApp();
        app.get("/hello", () => "hi");

        const res = await app.fetch(req("/nope", { method: "OPTIONS" }));

        expect(res.status).toBe(404);
    });

    test("OPTIONS はミドルウェア(CORS など)で先に返せる", async () => {
        const app = createApp();
        app.use((c, next) => {
            if (c.req.method === "OPTIONS") return c.header("access-control-allow-origin", "*").text("", 204);
            return next();
        });
        app.get("/hello", () => "hi");

        const res = await app.fetch(req("/hello", { method: "OPTIONS" }));

        expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    test("405 の Allow にも HEAD と OPTIONS が入る", async () => {
        const app = createApp();
        app.get("/hello", () => "hi");

        const res = await app.fetch(req("/hello", { method: "DELETE" }));

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    });
});

describe("パーセントエンコード", () => {
    test("日本語の静的ルートにマッチする", async () => {
        const app = createApp();
        app.get("/こんにちは", () => "ok");

        const res = await app.fetch(req("/こんにちは"));

        expect(res.status).toBe(200);
    });

    test("パスパラメーターはデコードされて届く", async () => {
        const app = createApp();
        app.get("/u/:name", ({ name }) => name);

        const res = await app.fetch(req("/u/山田"));

        expect(await res.text()).toBe("山田");
    });

    // どちらも、ルーターとミドルウェアで見え方が食い違う元になる
    const bad = [
        ["不正なエンコード", "/u/%E0%A4%A"],
        ["エンコードされた /", "/u/a%2Fb"],
    ];
    for (const [name, path] of bad) {
        test(`${name} (${path}) は 400`, async () => {
            const app = createApp();
            let called = false;
            app.get("/u/:name", () => {
                called = true;
                return "届いてはいけない";
            });

            const res = await app.fetch(req(path!));

            expect(res.status).toBe(400);
            expect(called).toBe(false);
        });
    }

    // %2E%2E は URL の仕様で ".." として先に解決される("/u/%2E%2E" → "/")ので、パラメーターには届かない
    for (const path of ["/u/%2E%2E", "/u/%2E"]) {
        test(`${path} はパラメーターとして届かない`, async () => {
            const app = createApp();
            let called = false;
            app.get("/u/:name", () => {
                called = true;
                return "届いてはいけない";
            });

            const res = await app.fetch(req(path));

            expect(res.status).toBe(404);
            expect(called).toBe(false);
        });
    }

    test("splitPath は念のため . と .. を 400 にする", () => {
        expect(() => splitPath("/u/..")).toThrow(HttpError);
        expect(() => splitPath("/u/.")).toThrow(HttpError);
        expect(splitPath("//a/b/")).toEqual(["a", "b"]);
    });
});
