// ドキュメントの「ルーティング」の章に書いた動き
import { expect } from "bun:test";
import { createApp, createRouter, defineRoutes } from "../../src/index.ts";
import { claim, quiet, req } from "./claim.ts";

// ---------- routing/routes ----------
{
    const app = createApp();
    app.get("/users/:id", ({ id }) => `user ${id}`);
    app.on("QUERY", "/search", () => "q");
    app.on(["PUT", "PATCH"], "/users/:id", () => "updated");
    app.all("/any", () => "どのメソッドでも");
    claim("routing/routes#on-all", "app.on(配列)と app.all", async () => {
        expect(await (await req(app, "PATCH", "/users/1")).text()).toBe("updated");
        expect(await (await req(app, "DELETE", "/any")).text()).toBe("どのメソッドでも");
    });
    claim("routing/routes#head", "HEAD は GET のルートで処理して本文を捨てる", async () => {
        const r = await req(app, "HEAD", "/users/1");
        expect(r.status).toBe(200);
        expect(await r.text()).toBe("");
    });
    claim("routing/routes#options", "OPTIONS は 204 と Allow", async () => {
        const r = await req(app, "OPTIONS", "/users/1");
        expect(r.status).toBe(204);
        expect(r.headers.get("allow")).toBeTruthy();
    });
    claim("routing/routes#query-method", "QUERY: 本文がなければ 400、Content-Type がなければ 415", async () => {
        expect((await req(app, "QUERY", "/search")).status).toBe(400);
        expect((await req(app, "QUERY", "/search", { body: new Uint8Array([1]) })).status).toBe(415);
    });
    claim("routing/routes#duplicate", "パラメーターの名前だけ違う同じルートは、登録のときのエラー", () => {
        expect(() => app.get("/users/:userId", () => "x")).toThrow();
    });
    claim("routing/routes#no-optional-or-regex", ":id? と :id{...} は登録のときのエラー", () => {
        expect(() => createApp().get("/a/:id?", () => "x")).toThrow();
        expect(() => createApp().get("/a/:id{[0-9]+}", () => "x")).toThrow();
    });
    claim("routing/routes#table", "app.routes() の表", async () => {
        const a = createApp();
        a.routes({ "GET /ping": () => "pong", "GET /users/:id": ({ id }) => ({ id }) });
        expect(await (await req(a, "GET", "/ping")).text()).toBe("pong");
    });
}

// ---------- routing/return-values ----------
{
    const app = createApp();
    app.get("/text", () => "こんにちは");
    app.get("/json", () => ({ ok: true }));
    app.get("/raw", () => new Response("そのまま", { status: 202 }));
    app.get("/bytes", () => new Uint8Array([1, 2]));
    app.get("/fn", (() => () => 1) as never);
    app.post("/items", (_, c) => {
        c.status(201);
        c.header("location", "/items/1");
        return { id: 1 };
    });
    claim("routing/return-values#table", "文字列・オブジェクト・本文になる値・Response", async () => {
        expect((await req(app, "GET", "/text")).headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect((await req(app, "GET", "/json")).headers.get("content-type")).toStartWith("application/json");
        expect(new Uint8Array(await (await req(app, "GET", "/bytes")).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
        const raw = await req(app, "GET", "/raw");
        expect(raw.status).toBe(202);
        expect(await raw.text()).toBe("そのまま");
    });
    claim("routing/return-values#status-header", "c.status() と c.header() のあとに値を返す", async () => {
        const r = await req(app, "POST", "/items");
        expect(r.status).toBe(201);
        expect(r.headers.get("location")).toBe("/items/1");
        expect(await r.json()).toEqual({ id: 1 });
    });
    claim("routing/return-values#function", "関数を返すと、実行したときも 500", async () => {
        expect((await quiet(() => req(app, "GET", "/fn"))).status).toBe(500);
    });
}

// ---------- routing/path-rules ----------
{
    const app = createApp();
    app.get("/users/me", () => "me");
    app.get("/users/:id", ({ id }) => `user ${id}`);
    app.get("/users", () => "list");
    app.get("/こんにちは", () => "hi");
    app.get("/a/b/c", () => "abc");
    app.get("/a/*", ({ "*": rest }) => `wild ${rest}`);
    claim("routing/path-rules#static-first", "静的なセグメントが先に当たる(登録の順番は関係ない)", async () => {
        expect(await (await req(app, "GET", "/users/me")).text()).toBe("me");
        expect(await (await req(app, "GET", "/users/1")).text()).toBe("user 1");
    });
    claim("routing/path-rules#slashes", "末尾と連続のスラッシュは無視する", async () => {
        for (const p of ["/users", "/users/", "//users"]) expect(await (await req(app, "GET", p)).text()).toBe("list");
    });
    claim("routing/path-rules#decode", "セグメントごとにデコードして、日本語のルートに当たる", async () => {
        expect(await (await req(app, "GET", `/${encodeURIComponent("こんにちは")}`)).text()).toBe("hi");
    });
    claim("routing/path-rules#bad-path-400", "デコードできないパスと %2F を含むパスは 400", async () => {
        expect((await req(app, "GET", "/users/a%2Fb")).status).toBe(400);
        expect((await req(app, "GET", "/users/%E0%A4%A")).status).toBe(400);
    });
    claim("routing/path-rules#backtrack", "枝で見つからなければ、戻って /a/* を試す", async () => {
        expect(await (await req(app, "GET", "/a/b/x")).text()).toBe("wild b/x");
    });
    claim("routing/path-rules#405-allow", "メソッドだけが違うときは 405 と Allow: GET, HEAD, OPTIONS", async () => {
        const r = await req(app, "DELETE", "/users/1");
        expect(r.status).toBe(405);
        expect(r.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    });
    claim("routing/path-rules#c-path", "c.path は正規化してデコードしたパス", async () => {
        const a = createApp();
        a.get("/x/:name", (_, c) => c.path);
        expect(await (await req(a, "GET", `//x/${encodeURIComponent("あ")}/`)).text()).toBe("/x/あ");
    });
}

// ---------- routing/wildcards ----------
{
    const app = createApp();
    app.get("/docs/*", ({ "*": page }) => `[${page}]`);
    app.get("/users/:id/files/*", ({ id, "*": path }) => `${id}: ${path}`);
    claim("routing/wildcards#values", "表のとおりの値になる", async () => {
        const table: [string, string | null][] = [["/docs", ""], ["/docs/", ""], ["/docs/a", "a"], ["/docs/a/", "a"], ["/docs//a", "a"], ["/docs/a/b", "a/b"], ["/docsx", null]];
        for (const [path, want] of table) {
            const r = await req(app, "GET", path);
            expect(r.status === 200 ? (await r.text()).slice(1, -1) : null).toBe(want);
        }
    });
    claim("routing/wildcards#with-params", "パラメーターと一緒に使える", async () => {
        expect(await (await req(app, "GET", "/users/1/files/a/b.txt")).text()).toBe("1: a/b.txt");
    });
    claim("routing/wildcards#position", "最後のセグメント全体にしか書けない", () => {
        for (const bad of ["/a/*/c", "/*.js", "/files*", "/*name"]) expect(() => createApp().get(bad, () => "x")).toThrow();
    });
    claim("routing/wildcards#not-405", "405 と OPTIONS には数えない(404)", async () => {
        expect((await req(app, "POST", "/docs/a")).status).toBe(404);
        expect((await req(app, "OPTIONS", "/docs/a")).status).toBe(404);
    });
    claim("routing/wildcards#backslash", "値に \\ が入る(/docs/..%5C..%5Csecret は ..\\..\\secret)", async () => {
        expect(await (await req(app, "GET", "/docs/..%5C..%5Csecret")).text()).toBe("[..\\..\\secret]");
    });
    claim("routing/wildcards#decode-once", "1 回だけデコードする(%252F は %2F のまま)", async () => {
        expect(await (await req(app, "GET", "/docs/%252F")).text()).toBe("[%2F]");
    });
    claim("routing/wildcards#use", 'app.use("/docs/*") は app.use("/docs") と同じ', async () => {
        const a = createApp();
        a.use("/docs/*", async (c, next) => {
            c.header("x-mw", "1");
            await next();
        });
        a.get("/docs", () => "d");
        expect((await req(a, "GET", "/docs")).headers.get("x-mw")).toBe("1");
    });
}

// ---------- routing/groups ----------
claim("routing/groups#router", "createRouter() の前置きとパラメーター", async () => {
    const app = createApp();
    const posts = createRouter("/users/:id/posts");
    posts.get("/", ({ id }) => `user ${id} の投稿`);
    posts.get("/:postId", ({ id, postId }) => `${id} / ${postId}`);
    app.route(posts);
    expect(await (await req(app, "GET", "/users/1/posts")).text()).toBe("user 1 の投稿");
    expect(await (await req(app, "GET", "/users/1/posts/2")).text()).toBe("1 / 2");
});
claim("routing/groups#mount-app", "別のアプリを前置きの下につなぐ", async () => {
    const app = createApp();
    const admin = createApp();
    admin.get("/stats", () => ({ users: 42 }));
    app.route("/admin", admin);
    expect(await (await req(app, "GET", "/admin/stats")).json()).toEqual({ users: 42 });
});
claim("routing/groups#define-routes-prefix", "defineRoutes() の前置き", async () => {
    const app = createApp();
    app.routes(defineRoutes("/orgs/:orgId")({ "GET /": ({ orgId }) => `org ${orgId}` }));
    expect(await (await req(app, "GET", "/orgs/7")).text()).toBe("org 7");
});
