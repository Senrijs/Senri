// etag() は Node でも、素の文字列とオブジェクトなら Request / Response を作らない。応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cors, createApp, etag, secureHeaders, type Middleware } from "../../src/index.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

const tagIn = (text: string) => /^etag: (.*)$/im.exec(text)?.[1];

function makeApp(...middleware: Middleware[]) {
    const app = createApp();
    app.use(etag());
    for (const mw of middleware) app.use(mw);
    app.get("/text", () => "hello");
    app.get("/utf8", () => "日本語");
    app.get("/empty", () => "");
    app.get("/json", () => ({ a: 1 }));
    app.get("/array", () => [1, 2]);
    app.get("/c-text", (_, c) => c.text("hello"));
    app.get("/response", () => new Response("hello"));
    app.get("/big", () => "x".repeat(1024 * 1024 + 1));
    app.get("/created", (_, c) => {
        c.status(201);
        return "x";
    });
    app.get("/headers", (_, c) => {
        c.header("cache-control", "max-age=60");
        c.header("set-cookie", "a=1");
        c.header("x-mark", "1");
        return "x";
    });
    app.get("/own-type", (_, c) => {
        c.header("content-type", "text/html");
        return "<p>x</p>";
    });
    app.get("/own-header", (_, c) => {
        c.header("etag", '"by-header"');
        return "x";
    });
    app.get("/boom", () => {
        throw new Error("boom");
    });
    app.post("/text", () => "hello");
    return app;
}

const PATHS = ["/text", "/utf8", "/empty", "/json", "/array", "/c-text", "/response", "/big", "/created", "/headers", "/own-type", "/own-header", "/boom", "/none"];

describe("etag() と Node の近道", () => {
    test("素の文字列とオブジェクトなら、Request も Response も作らない", async () => {
        const port = await listen(makeApp(secureHeaders(), cors()));
        for (const path of ["/text", "/json", "/array", "/utf8"]) {
            const counts = await counting(async () => {
                assert.ok(tagIn(await raw(port, request("GET", path))), path);
            });
            assert.deepEqual(counts, { Request: 0, Response: 0 }, path);
        }
    });

    test("304 でも Request は作らない", async () => {
        const port = await listen(makeApp());
        const tag = tagIn(await raw(port, request("GET", "/text")))!;

        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/text", { "If-None-Match": tag })), /^HTTP\/1\.1 304/);
        });
        assert.equal(counts.Request, 0);
    });

    test("2つの道の応答が同じ(ETag の値も)", async () => {
        const { lazy, viaFetch } = await bothPaths(makeApp());
        for (const path of PATHS) {
            for (const method of ["GET", "HEAD", "POST"]) {
                const text = request(method, path);
                assert.equal(await raw(lazy, text), await raw(viaFetch, text), `${method} ${path}`);
            }
            for (const value of ["*", '"other"']) {
                const text = request("GET", path, { "If-None-Match": value });
                assert.equal(await raw(lazy, text), await raw(viaFetch, text), `${path} ${value}`);
            }
            const tag = tagIn(await raw(lazy, request("GET", path)));
            if (tag) {
                const text = request("GET", path, { "If-None-Match": tag });
                assert.equal(await raw(lazy, text), await raw(viaFetch, text), `${path} ${tag}`);
            }
        }
    });

    test("内側に純正のミドルウェアがあっても、2つの道の応答が同じ", async () => {
        const { lazy, viaFetch } = await bothPaths(makeApp(secureHeaders(), cors()));
        for (const path of PATHS) {
            const headers = { Origin: "https://a.example" };
            const first = request("GET", path, headers);
            const answer = await raw(lazy, first);
            assert.equal(answer, await raw(viaFetch, first), path);
            const tag = tagIn(answer);
            if (tag) {
                const text = request("GET", path, { ...headers, "If-None-Match": tag });
                assert.equal(await raw(lazy, text), await raw(viaFetch, text), `${path} 304`);
            }
        }
    });

    test("利用者のミドルウェアが外側にあれば、本物の Response を渡す", async () => {
        let real = false;
        const app = createApp();
        app.use(async (_c, next) => {
            const res = await next();
            real = Object.getPrototypeOf(res) === Response.prototype && res.headers.has("etag");
            return res;
        });
        app.use(etag());
        app.get("/", () => "x");
        await raw(await listen(app), request("GET", "/"));

        assert.equal(real, true);
    });
});
