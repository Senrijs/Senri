import { describe, expect, test } from "bun:test";
import { cache, createApp, etag, type CacheOptions } from "../src/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf } from "./bundle.ts";

const CC = "public, max-age=60";

function makeApp(options: CacheOptions = { cacheControl: CC }) {
    const app = createApp();
    app.use(cache(options));
    app.get("/text", () => "x");
    app.get("/json", () => ({ a: 1 }));
    app.get("/created", (_, c) => {
        c.status(201);
        return "x";
    });
    app.get("/own-response", () => new Response("x", { headers: { "cache-control": "no-store" } }));
    app.get("/own-header", (_, c) => {
        c.header("cache-control", "max-age=1");
        return "x";
    });
    app.get("/vary", () => new Response("x", { headers: { vary: "Origin" } }));
    app.get("/redirect", (_, c) => c.redirect("/x"));
    app.get("/boom", () => {
        throw new Error("boom");
    });
    app.get("/immutable", () => fetch("data:text/plain,x"));
    app.post("/text", () => "x");
    return app;
}

const go = (app: ReturnType<typeof makeApp>, path: string, method = "GET") => app.fetch(new Request(`http://localhost${path}`, { method }));

describe("cache()", () => {
    test("GET / HEAD の 2xx に Cache-Control を付ける", async () => {
        const app = makeApp();
        for (const path of ["/text", "/json", "/created"]) {
            expect((await go(app, path)).headers.get("cache-control"), path).toBe(CC);
        }
        expect((await go(app, "/text", "HEAD")).headers.get("cache-control")).toBe(CC);
    });

    test("本文はそのまま", async () => {
        expect(await (await go(makeApp(), "/json")).json()).toEqual({ a: 1 });
    });

    test("付けないもの: POST、3xx、4xx、5xx", async () => {
        const app = makeApp();

        expect((await go(app, "/text", "POST")).headers.get("cache-control")).toBeNull();
        expect((await go(app, "/redirect")).headers.get("cache-control")).toBeNull();
        expect((await go(app, "/none")).headers.get("cache-control")).toBeNull();
        expect((await go(app, "/boom")).headers.get("cache-control")).toBeNull();
    });

    test("Response の Cache-Control を上書きしない", async () => {
        expect((await go(makeApp(), "/own-response")).headers.get("cache-control")).toBe("no-store");
    });

    test("c.header() の Cache-Control が勝つ", async () => {
        expect((await go(makeApp(), "/own-header")).headers.get("cache-control")).toBe("max-age=1");
    });

    test("vary を足す。既存の Vary は残す", async () => {
        const app = makeApp({ cacheControl: CC, vary: ["Accept-Language", "Cookie"] });

        expect((await go(app, "/text")).headers.get("vary")).toBe("Accept-Language, Cookie");
        expect((await go(app, "/vary")).headers.get("vary")).toBe("Origin, Accept-Language, Cookie");
        expect((await go(app, "/none")).headers.get("vary")).toBeNull();
    });

    test("ヘッダーを変更できないレスポンスにも付けられる", async () => {
        const res = await go(makeApp(), "/immutable");

        expect(res.headers.get("cache-control")).toBe(CC);
        expect(await res.text()).toBe("x");
    });

    test("先に登録すれば、etag() の 304 にも付く", async () => {
        const app = createApp();
        app.use(cache({ cacheControl: CC, vary: ["X-A"] }));
        app.use(etag());
        app.get("/", () => "x");
        const tag = (await app.fetch(new Request("http://localhost/"))).headers.get("etag")!;
        const res = await app.fetch(new Request("http://localhost/", { headers: { "if-none-match": tag } }));

        expect(res.status).toBe(304);
        expect(res.headers.get("etag")).toBe(tag);
        expect(res.headers.get("cache-control")).toBe(CC);
        expect(res.headers.get("vary")).toBe("X-A");
    });

    test("パス指定で、その下だけに付ける", async () => {
        const app = createApp();
        app.use("/assets", cache({ cacheControl: CC }));
        app.get("/assets/a", () => "x");
        app.get("/page", () => "x");

        expect((await app.fetch(new Request("http://localhost/assets/a"))).headers.get("cache-control")).toBe(CC);
        expect((await app.fetch(new Request("http://localhost/page"))).headers.get("cache-control")).toBeNull();
    });

    test.each([
        [{}],
        [{ cacheControl: "" }],
        [{ cacheControl: 60 }],
        [{ cacheControl: "a\r\nX-Evil: 1" }],
        [{ cacheControl: "日本語" }],
        [{ cacheControl: CC, vary: "Origin" }],
        [{ cacheControl: CC, vary: ["bad name"] }],
    ])("不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            cache(options as CacheOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err)).toContain("cache()");
    });

    test("名前と印", () => {
        const middleware = cache({ cacheControl: CC });

        expect(middleware.name).toBe("cache");
        expect(isPlainSafe(middleware)).toBe(true);
    });

    test("使わなければ、本体に入らない", async () => {
        expect(await bundleOf("createApp")).not.toContain("cache-control");
    });
});
