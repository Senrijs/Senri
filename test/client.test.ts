import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { client } from "../src/client.ts";
import { createApp, defineRoutes, endpoint, HttpError } from "../src/index.ts";

const routes = defineRoutes({
    "GET /users/:id": ({ id }) => ({ id, at: new Date(0) }),
    "GET /search": (_, c) => ({ q: c.query("q") ?? null, tags: c.req.url.split("?")[1] ?? "" }),
    "POST /users": endpoint({ body: z.object({ name: z.string() }) }, (_, c) => ({ created: c.valid("body").name })),
    "GET /text": () => "hello",
    "GET /bytes": () => new Uint8Array([1, 2, 3]),
    "GET /files/*": ({ "*": rest }) => ({ rest }),
    "GET /teapot": () => {
        throw new HttpError(418, "418 I'm a teapot");
    },
    "DELETE /users/:id": (_, c) => c.body(),
    "POST /echo": async (_, c) => ({ type: c.req.headers.get("content-type"), text: await c.req.text() }),
    "GET /headers": (_, c) => ({ auth: c.req.headers.get("authorization"), extra: c.req.headers.get("x-extra") }),
    "GET /empty": () => new Response(null, { status: 204 }),
});
type Api = typeof routes;

const app = createApp();
app.routes(routes);
const api = client<Api>("http://localhost/", { fetch: (req) => app.fetch(req) });

describe("client()", () => {
    test("パラメーターをパスに入れ、JSON を読む", async () => {
        const res = await api("GET /users/:id", { params: { id: "a b&c?" } });
        expect(res.ok).toBe(true);
        expect(res.status).toBe(200);
        // パラメーターはエンコードされて届き、サーバーでデコードされる
        expect(res.data).toEqual({ id: "a b&c?", at: "1970-01-01T00:00:00.000Z" });
    });

    test("クエリ: undefined と null は送らない。配列は同じキーを繰り返す", async () => {
        const res = await api("GET /search", { query: { q: "x", tag: ["a", "b"], skip: undefined, none: null, n: 1 } });
        expect(res.data).toEqual({ q: "x", tags: "q=x&tag=a&tag=b&n=1" });
    });

    test("本文は JSON で送る。スキーマを通った値が届く", async () => {
        const res = await api("POST /users", { body: { name: "a" } });
        expect(res.data).toEqual({ created: "a" });
    });

    test("2xx でなければ例外にせず、ok: false と error を返す", async () => {
        const res = await api("POST /users", { body: { name: 1 } as never });
        expect(res.ok).toBe(false);
        expect(res.status).toBe(400);
        expect(res.data).toBeUndefined();
        expect(res.error).toBe("400 Bad Request");

        const teapot = await api("GET /teapot");
        expect([teapot.ok, teapot.status, teapot.error]).toEqual([false, 418, "418 I'm a teapot"]);
    });

    test("テキストは文字列、バイト列は Blob で読む。本文がなければ null", async () => {
        expect((await api("GET /text")).data).toBe("hello");
        const bytes = (await api("GET /bytes")).data;
        expect(bytes).toBeInstanceOf(Blob);
        expect([...new Uint8Array(await (bytes as Blob).arrayBuffer())]).toEqual([1, 2, 3]);
        const empty = await api("GET /empty");
        expect([empty.ok, empty.status, empty.data]).toEqual([true, 204, null]);
    });

    test("ワイルドカードは \"/\" を残して、セグメントごとにエンコードする", async () => {
        expect((await api("GET /files/*", { params: { "*": "a/b c/d" } })).data).toEqual({ rest: "a/b c/d" });
    });

    test("FormData・URLSearchParams・Blob はそのまま送る", async () => {
        const form = await api("POST /echo", { body: new URLSearchParams({ a: "1" }) });
        expect(form.data).toEqual({ type: "application/x-www-form-urlencoded;charset=UTF-8", text: "a=1" });
        const blob = await api("POST /echo", { body: new Blob(["raw"], { type: "text/plain" }) });
        expect(blob.data).toMatchObject({ text: "raw" });
        expect((blob.data as { type: string }).type).toStartWith("text/plain");
    });

    test("ヘッダー: クライアントのものと呼ぶときのものを合わせる。関数なら呼ぶたびに読む", async () => {
        let token = "one";
        const withAuth = client<Api>("http://localhost", { fetch: (req) => app.fetch(req), headers: () => ({ authorization: token }) });
        expect((await withAuth("GET /headers", { headers: { "x-extra": "1" } })).data).toEqual({ auth: "one", extra: "1" });
        token = "two";
        expect((await withAuth("GET /headers")).data).toEqual({ auth: "two", extra: null });
    });

    test("ベース URL のパスの後ろにつなぐ", async () => {
        const seen: string[] = [];
        const sub = client<Api>("https://example.com/api/", {
            fetch: (req) => (seen.push(req.url), new Response("{}", { headers: { "content-type": "application/json" } })),
        });
        await sub("GET /users/:id", { params: { id: 1 } });
        expect(seen).toEqual(["https://example.com/api/users/1"]);
    });

    test("パラメーターが足りなければ、送る前にエラー", async () => {
        await expect(api("GET /users/:id", { params: {} } as never)).rejects.toThrow("Missing path parameter: id");
    });

    test("壊れた JSON は例外", async () => {
        const broken = client<Api>("http://x", { fetch: () => new Response("{", { headers: { "content-type": "application/json" } }) });
        await expect(broken("GET /text")).rejects.toThrow();
    });
});
