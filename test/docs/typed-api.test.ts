// ドキュメントの「型付きの API」の章に書いた動き
import { expect } from "bun:test";
import { z } from "zod";
import { createApp, defineRoutes, endpoint, mergeRoutes } from "../../src/index.ts";
import { client } from "../../src/client.ts";
import { request, testClient } from "../../src/testing.ts";
import { openAPI } from "../../src/openapi.ts";
import { getCookie, setCookie } from "../../src/cookie.ts";
import { getIp } from "../../src/ip.ts";
import { claim, quiet, req } from "./claim.ts";

// ---------- typed-api/define-routes ----------
claim("typed-api/define-routes#merge", "表を合わせる。同じキーが 2 つあればエラー", async () => {
    const a = defineRoutes({ "GET /users/:id": ({ id }) => ({ id }) });
    const b = defineRoutes("/orgs/:orgId")({ "GET /": ({ orgId }) => `org ${orgId}` });
    const app = createApp();
    app.routes(mergeRoutes(a, b));
    expect(await (await req(app, "GET", "/orgs/1")).text()).toBe("org 1");
    expect(() => mergeRoutes(a, defineRoutes({ "GET /users/:id": () => "x" }))).toThrow();
});
claim("typed-api/define-routes#checked-on-routes", "パスの書き方と 2 回登録の確認は、app.routes() に渡したときに行う", () => {
    const app = createApp();
    app.get("/x", () => "x");
    expect(() => app.routes(defineRoutes({ "GET /x": () => "y" }))).toThrow();
    expect(() => createApp().routes(defineRoutes({ "GET /a/:id?": () => "y" }))).toThrow();
});

// ---------- typed-api/client ----------
{
    const routes = defineRoutes({
        "GET /users/:id": ({ id }, c) => (id === "0" ? c.json({ message: "not found" }, 404) : { id, at: new Date(0) }),
        "GET /text": () => "plain",
        "GET /bin": () => new Uint8Array([1]),
        "POST /users": endpoint({ body: z.object({ name: z.string() }) }, (_, c) => ({ created: c.valid("body").name })),
        "GET /q": (_, c) => ({ tags: c.queries("tag"), page: c.query("page") ?? null, path: c.path }),
    });
    const app = createApp();
    app.routes(routes);
    const api = client<typeof routes>("http://localhost", { fetch: (r) => app.fetch(r) });
    claim("typed-api/client#result", "{ ok, status, data, error, response } を返し、2xx でなくても例外にしない", async () => {
        const ok = await api("GET /users/:id", { params: { id: "1" } });
        expect(ok.ok && ok.status === 200 && ok.response instanceof Response).toBe(true);
        const ng = await api("GET /users/:id", { params: { id: "0" } });
        expect(ng.ok).toBe(false);
        expect(ng.status).toBe(404);
        expect(ng.error).toEqual({ message: "not found" });
    });
    claim("typed-api/client#json-shape", "data は JSON にしたあとの形(Date は string)", async () => {
        const r = await api("GET /users/:id", { params: { id: "1" } });
        expect(typeof (r.data as { at: unknown }).at).toBe("string");
    });
    claim("typed-api/client#content-type", "JSON は値、text/* は文字列、それ以外は Blob", async () => {
        expect((await api("GET /text")).data).toBe("plain");
        expect((await api("GET /bin")).data).toBeInstanceOf(Blob);
    });
    claim("typed-api/client#send", "params はエンコードしてパスに、query の配列は同じキーを繰り返し、body は JSON", async () => {
        const q = await api("GET /q", { query: { tag: ["a", "b"], page: 2 } });
        expect(q.data).toMatchObject({ tags: ["a", "b"], page: "2" });
        const p = await api("POST /users", { body: { name: "a" } });
        expect(p.data).toEqual({ created: "a" });
        const e = await api("GET /users/:id", { params: { id: "a b" } });
        expect(e.data).toMatchObject({ id: "a b" });
    });
}

// ---------- typed-api/testing ----------
{
    const routes = defineRoutes({
        "POST /login": (_, c) => {
            setCookie(c, "session", "ok");
            return "ok";
        },
        "GET /me": (_, c) => ({ session: getCookie(c, "session") ?? null, ip: getIp(c), env: (c.env as { GREETING?: string } | undefined)?.GREETING ?? null, h: c.req.headers.get("x-test") }),
    });
    const app = createApp();
    app.routes(routes);
    claim("typed-api/testing#cookies", "{ cookies: true } で、前の応答の Set-Cookie を次に付ける", async () => {
        const api = testClient<typeof routes>(app, { cookies: true });
        await api("POST /login");
        expect((await api("GET /me")).data).toMatchObject({ session: "ok" });
    });
    claim("typed-api/testing#ip", "接続元は 127.0.0.1。{ ip } で変えられる", async () => {
        expect((await testClient<typeof routes>(app)("GET /me")).data).toMatchObject({ ip: "127.0.0.1" });
        expect((await testClient<typeof routes>(app, { ip: "10.0.0.1" })("GET /me")).data).toMatchObject({ ip: "10.0.0.1" });
    });
    claim("typed-api/testing#workers", "{ env, ctx } を渡すと、接続元は渡さない", async () => {
        const ctx = { waitUntil() {}, passThroughOnException() {} };
        const r = await testClient<typeof routes>(app, { env: { GREETING: "hi" }, ctx })("GET /me");
        expect(r.data).toMatchObject({ env: "hi", ip: null });
    });
    claim("typed-api/testing#headers", "{ headers } で毎回付けるヘッダー", async () => {
        expect((await testClient<typeof routes>(app, { headers: { "x-test": "1" } })("GET /me")).data).toMatchObject({ h: "1" });
    });
    claim("typed-api/testing#request", "request() は Response を返す", async () => {
        const res = await request(app, "POST /upload", { body: new FormData() });
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(404);
    });
}

// ---------- typed-api/openapi ----------
claim("typed-api/openapi#document", "3.1、:id → {id}、response と responses と openapi が入る", async () => {
    const routes = defineRoutes({
        "GET /users/:id": endpoint(
            { params: z.object({ id: z.coerce.number() }), response: z.object({ id: z.number() }), responses: { 404: z.object({ message: z.string() }) }, openapi: { summary: "ユーザーを取る", tags: ["users"] } },
            ({ id }) => ({ id }),
        ),
    });
    const doc = (await quiet(() => openAPI(routes, { info: { title: "My API", version: "1.0.0" } }))) as {
        openapi: string;
        paths: Record<string, Record<string, { summary?: string; tags?: string[]; responses: Record<string, unknown> }>>;
    };
    expect(doc.openapi.startsWith("3.1")).toBe(true);
    const op = doc.paths["/users/{id}"]!.get!;
    expect(Object.keys(op.responses).sort()).toEqual(["200", "404"]);
    expect(op.summary).toBe("ユーザーを取る");
    expect(op.tags).toEqual(["users"]);
});
claim("typed-api/openapi#only-table", "表にない app.get() のルートは入らない", async () => {
    const routes = defineRoutes({ "GET /a": () => "a" });
    const doc = (await quiet(() => openAPI(routes, { info: { title: "t", version: "1" } }))) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(["/a"]);
});
