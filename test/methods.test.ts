import { describe, expect, test } from "bun:test";
import { createApp, createRouter } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("app.on", () => {
    test("任意のメソッド(WebDAV など)を登録できる", async () => {
        const app = createApp();
        app.on("PROPFIND", "/dav/:name", ({ name }) => `props of ${name}`);

        const res = await app.fetch(req("/dav/a.txt", { method: "PROPFIND" }));
        expect(await res.text()).toBe("props of a.txt");
    });

    test("メソッドの配列で、まとめて登録できる", async () => {
        const app = createApp();
        app.on(["GET", "POST"], "/both", (_, c) => c.req.method);

        expect(await (await app.fetch(req("/both"))).text()).toBe("GET");
        expect(await (await app.fetch(req("/both", { method: "POST" }))).text()).toBe("POST");
        expect(app.routeList()).toEqual([
            { method: "GET", path: "/both" },
            { method: "POST", path: "/both" },
        ]);
    });

    test("小文字で書いても大文字のメソッドとして登録される", async () => {
        const app = createApp();
        app.on("mkcol", "/dir", () => "made");

        expect(await (await app.fetch(req("/dir", { method: "MKCOL" }))).text()).toBe("made");
    });

    test("CONNECT / TRACE / TRACK は登録できない", () => {
        const app = createApp();
        for (const method of ["CONNECT", "TRACE", "TRACK", "trace"]) {
            expect(() => app.on(method, "/x", () => "x")).toThrow("扱いません");
        }
        expect(() => app.routes({ "TRACE /x": () => "x" })).toThrow("扱いません");
    });

    test("メソッド名に使えない文字はエラー", () => {
        const app = createApp();
        expect(() => app.on("GET POST", "/x", () => "x")).toThrow("メソッド名");
        expect(() => app.on("", "/x", () => "x")).toThrow("メソッド名");
        expect(() => app.on([], "/x", () => "x")).toThrow("メソッド");
    });

    test("ALL は app.all() を使うよう案内する", () => {
        const app = createApp();
        expect(() => app.on("ALL", "/x", () => "x")).toThrow("app.all()");
    });

    test("ルーターでも使える", async () => {
        const dav = createRouter("/dav/:user");
        dav.on("PROPFIND", "/:name", ({ user, name }) => `${user}/${name}`);
        const app = createApp();
        app.route(dav);

        expect(await (await app.fetch(req("/dav/u/f", { method: "PROPFIND" }))).text()).toBe("u/f");
    });
});

describe("app.head / app.options", () => {
    test("HEAD を登録すれば、GET より優先される", async () => {
        const app = createApp();
        let calledGet = false;
        app.get("/file", () => {
            calledGet = true;
            return "body";
        });
        app.head("/file", (_, c) => {
            c.header("x-size", "4");
            return "";
        });

        const res = await app.fetch(req("/file", { method: "HEAD" }));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-size")).toBe("4");
        expect(calledGet).toBe(false);
    });

    test("HEAD でもボディは送らない", async () => {
        const app = createApp();
        app.head("/h", () => "should be dropped");

        const res = await app.fetch(req("/h", { method: "HEAD" }));
        expect(res.body).toBeNull();
    });

    test("HEAD を登録していなければ、今までどおり GET を使う", async () => {
        const app = createApp();
        app.get("/file", (_, c) => {
            c.header("x-from", "get");
            return "body";
        });

        const res = await app.fetch(req("/file", { method: "HEAD" }));
        expect(res.headers.get("x-from")).toBe("get");
        expect(res.body).toBeNull();
    });

    test("OPTIONS を登録すれば、自動の 204 より優先される", async () => {
        const app = createApp();
        app.get("/x", () => "x");
        app.options("/x", (_, c) => {
            c.header("x-custom", "1");
            return "custom";
        });

        const res = await app.fetch(req("/x", { method: "OPTIONS" }));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("custom");
        expect(res.headers.get("x-custom")).toBe("1");
    });

    test("OPTIONS を登録していなければ、今までどおり 204 と Allow", async () => {
        const app = createApp();
        app.get("/x", () => "x");
        app.on("QUERY", "/x", () => "q");

        const res = await app.fetch(req("/x", { method: "OPTIONS" }));
        expect(res.status).toBe(204);
        expect(res.headers.get("allow")).toBe("GET, HEAD, QUERY, OPTIONS");
    });

    test("ルーターでも使える", async () => {
        const r = createRouter("/r");
        r.head("/", () => "");
        r.options("/", () => "opts");
        const app = createApp();
        app.route(r);

        expect((await app.fetch(req("/r", { method: "HEAD" }))).status).toBe(200);
        expect(await (await app.fetch(req("/r", { method: "OPTIONS" }))).text()).toBe("opts");
    });
});

describe("QUERY メソッド", () => {
    const json = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) => ({
        method: "QUERY",
        headers,
        body,
    });

    test("ボディの条件を受け取って返せる", async () => {
        const app = createApp();
        app.on("QUERY", "/search", async (_, c) => {
            const { q } = await c.body<{ q: string }>();
            return { results: [q] };
        });

        const res = await app.fetch(req("/search", json(`{"q":"senri"}`)));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ results: ["senri"] });
    });

    test("Content-Type がなければ 415(ハンドラーは呼ばれない)", async () => {
        const app = createApp();
        let called = false;
        app.on("QUERY", "/search", () => {
            called = true;
            return "x";
        });

        const res = await app.fetch(req("/search", json(`{"q":1}`, {})));
        expect(res.status).toBe(415);
        expect(await res.text()).toBe("415 Unsupported Media Type");
        expect(called).toBe(false);
    });

    test("ボディが空なら 400", async () => {
        const app = createApp();
        app.on("QUERY", "/search", () => "x");

        const noBody = await app.fetch(req("/search", { method: "QUERY" }));
        expect(noBody.status).toBe(400);
        expect(await noBody.text()).toBe("400 Bad Request");

        const empty = await app.fetch(
            req("/search", { method: "QUERY", headers: { "content-type": "application/json", "content-length": "0" }, body: "" }),
        );
        expect(empty.status).toBe(400);
    });

    test("開発モードでは、理由と直し方を返す", async () => {
        const app = createApp({ dev: true });
        app.on("QUERY", "/search", () => "x");

        const noType = await (await app.fetch(req("/search", json(`{"q":1}`, {})))).text();
        expect(noType).toContain("415 Unsupported Media Type");
        expect(noType).toContain("Content-Type");
        expect(noType).toContain("application/json");

        const noBody = await (await app.fetch(req("/search", { method: "QUERY" }))).text();
        expect(noBody).toContain("400 Bad Request");
        expect(noBody).toContain("ボディ");
    });

    test("ミドルウェアは確認の前に動く(CORS などのヘッダーが付く)", async () => {
        const app = createApp();
        app.use(async (c, next) => {
            c.header("x-mw", "1");
            await next();
        });
        app.on("QUERY", "/search", () => "x");

        const res = await app.fetch(req("/search", json(`{}`, {})));
        expect(res.status).toBe(415);
        expect(res.headers.get("x-mw")).toBe("1");
    });

    test("app.all で受けたときは確認しない(ハンドラーに任せる)", async () => {
        const app = createApp();
        app.all("/any", (_, c) => c.req.method);

        expect(await (await app.fetch(req("/any", { method: "QUERY" }))).text()).toBe("QUERY");
    });

    test("routes() のテーブルでも書ける", async () => {
        const app = createApp();
        app.routes({ "QUERY /s/:kind": ({ kind }) => kind });

        expect(await (await app.fetch(req("/s/books", json("{}")))).text()).toBe("books");
    });
});

describe("扱わないメソッド", () => {
    test("TRACE / TRACK は app.all() があっても 501", async () => {
        const app = createApp();
        let called = false;
        app.all("/x", () => {
            called = true;
            return "x";
        });

        // Request は TRACE を作れず(fetch の仕様で禁止)、Bun は TRACK を GET にしてしまうので、メソッドだけ差し替えて確かめる
        for (const method of ["CONNECT", "TRACE", "TRACK"]) {
            const r = new Request("http://localhost/x");
            Object.defineProperty(r, "method", { value: method });
            expect((await app.fetch(r)).status).toBe(501);
        }
        expect(called).toBe(false);
    });
});
