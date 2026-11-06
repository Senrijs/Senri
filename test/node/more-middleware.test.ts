// trailingSlash() / cache() / languageDetector() / prettyJSON() は Node でも Request / Response を作らない
// 応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cache, cors, createApp, languageDetector, prettyJSON, secureHeaders, trailingSlash, type Middleware } from "../../src/index.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function makeApp(...middleware: Middleware[]) {
    const app = createApp();
    for (const mw of middleware) app.use(mw);
    app.get("/", () => "root");
    app.get("/text", () => "x");
    app.get("/json", () => ({ a: 1, b: [2] }));
    app.get("/array", () => [1]);
    app.get("/c-json", (_, c) => c.json({ a: 1 }));
    app.get("/response", () => new Response('{"a":1}', { headers: { "content-type": "application/json" } }));
    app.get("/language", (_, c) => String(c.get("language")));
    app.get("/own", (_, c) => {
        c.header("cache-control", "max-age=1");
        c.status(201);
        return { a: 1 };
    });
    app.get("/own-type", (_, c) => {
        c.header("content-type", "application/problem+json");
        return { a: 1 };
    });
    app.get("/boom", () => {
        throw new Error("boom");
    });
    app.post("/text", () => "posted");
    return app;
}

const language = () => languageDetector({ supportedLanguages: ["ja", "en"], fallbackLanguage: "en" });
const PATHS = ["/", "/text", "/text/", "/text?a=1", "/text/?a=1", "/json", "/json?pretty", "/array?pretty", "/c-json?pretty", "/response?pretty", "/language", "/language?lang=ja", "/own", "/own?pretty", "/own-type?pretty", "/boom", "/none", "/none/"];

describe("Node の近道", () => {
    const list: [string, string, Middleware, Record<string, string>?][] = [
        ["trailingSlash", "/text", trailingSlash()],
        ['trailingSlash("add")', "/text/", trailingSlash({ mode: "add" })],
        ["cache", "/json", cache({ cacheControl: "max-age=60", vary: ["X-A"] })],
        ["languageDetector", "/json", language(), { "Accept-Language": "ja", Cookie: "a=1" }],
        ["prettyJSON", "/json?pretty", prettyJSON()],
        ["prettyJSON(なし)", "/json", prettyJSON()],
    ];
    for (const [name, path, middleware, headers] of list) {
        test(`${name}: Request も Response も作らない`, async () => {
            const port = await listen(makeApp(middleware, secureHeaders(), cors()));

            const counts = await counting(async () => {
                assert.match(await raw(port, request("GET", path, headers)), /^HTTP\/1\.1 200/);
            });
            assert.deepEqual(counts, { Request: 0, Response: 0 });
        });
    }

    test("prettyJSON: 素のオブジェクトを、Response を作らずに整形する", async () => {
        const port = await listen(makeApp(prettyJSON()));

        const counts = await counting(async () => {
            const text = await raw(port, request("GET", "/json?pretty"));
            assert.ok(text.endsWith('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}'), text);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("trailingSlash: リダイレクトのときも Request は作らない", async () => {
        const port = await listen(makeApp(trailingSlash()));

        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/text/?a=1")), /^location: \/text\?a=1$/im);
        });
        assert.equal(counts.Request, 0);
    });
});

describe("2つの道の応答が同じ", () => {
    const groups: [string, () => Middleware[]][] = [
        ["trailingSlash", () => [trailingSlash()]],
        ['trailingSlash("add")', () => [trailingSlash({ mode: "add", status: 308 })]],
        ["cache", () => [cache({ cacheControl: "public, max-age=60", vary: ["X-A"] })]],
        ["languageDetector", () => [language()]],
        ["prettyJSON", () => [prettyJSON({ space: 4 })]],
        ["全部", () => [trailingSlash(), cache({ cacheControl: "max-age=60" }), language(), secureHeaders(), cors(), prettyJSON()]],
        ["全部 + 利用者のミドルウェア", () => [trailingSlash(), cache({ cacheControl: "max-age=60" }), (_c, next) => next(), language(), prettyJSON()]],
    ];
    const headerSets: Record<string, string>[] = [{}, { "Accept-Language": "ja, en;q=0.5" }, { Cookie: "language=ja" }, { Origin: "https://a.example" }];
    for (const [name, make] of groups) {
        test(name, async () => {
            const { lazy, viaFetch } = await bothPaths(makeApp(...make()));
            for (const path of PATHS) {
                for (const headers of headerSets) {
                    for (const method of ["GET", "HEAD", "POST"]) {
                        const text = request(method, path, headers);
                        assert.equal(await raw(lazy, text), await raw(viaFetch, text), `${method} ${path} ${JSON.stringify(headers)}`);
                    }
                }
            }
        });
    }
});
