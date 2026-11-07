import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cors, createApp, etag, type Middleware } from "../src/index.ts";
import { serveStatic } from "../adapters/static/index.ts";
import { devtools } from "../src/dev/index.ts";
import { peekBody } from "../src/middleware/read-body.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf, CONTEXT_MARKER } from "./bundle.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const inm = (path: string, value: string, method = "GET") => req(path, { method, headers: { "if-none-match": value } });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const WEAK = /^W\/"[0-9a-f]+-[0-9a-f]{16}"$/;
const BIG = "x".repeat(1024 * 1024 + 1);

const slowStream = () =>
    new ReadableStream({
        async start(controller) {
            await sleep(30);
            controller.enqueue(new TextEncoder().encode("slow"));
            controller.close();
        },
    });

function makeApp(options?: Parameters<typeof etag>[0]) {
    const app = createApp();
    app.use(etag(options));
    app.get("/text", () => "hello");
    app.get("/c-text", (_, c) => c.text("hello"));
    app.get("/json", () => ({ a: 1 }));
    app.get("/array", () => [1, 2]);
    app.get("/bytes", () => new Uint8Array([1, 2, 3]));
    app.get("/response", () => new Response("hello", { headers: { "content-type": "text/plain" } }));
    app.get("/empty", () => "");
    app.get("/utf8", () => "日本語");
    app.get("/changed", () => "hellp");
    app.get("/big", () => BIG);
    app.get("/created", (_, c) => {
        c.status(201);
        return "x";
    });
    app.get("/no-content", () => new Response(null, { status: 204 }));
    app.get("/partial", () => new Response("x", { status: 206 }));
    app.get("/redirect", (_, c) => c.redirect("/x"));
    app.get("/boom", () => {
        throw new Error("boom");
    });
    app.get("/own", () => new Response("x", { headers: { etag: '"mine"' } }));
    app.get("/own-header", (_, c) => {
        c.header("etag", '"by-header"');
        return "x";
    });
    app.get("/headers", (_, c) => {
        c.header("cache-control", "max-age=60");
        c.header("x-mark", "1");
        c.header("set-cookie", "a=1");
        return new Response("x", { headers: { "content-type": "text/plain", "content-language": "ja", vary: "accept", "set-cookie": "b=2", "x-res": "2" } });
    });
    app.get("/slow", () => new Response(slowStream()));
    app.get("/fast-stream", () => {
        return new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode("fast"));
                    controller.close();
                },
            }),
        );
    });
    app.get("/sse", () => {
        return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "Text/Event-Stream; charset=utf-8" } });
    });
    app.get("/broken", () => {
        return new Response(
            new ReadableStream({
                start(controller) {
                    controller.error(new Error("broken"));
                },
            }),
        );
    });
    app.get("/strings", () => {
        return new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue("not bytes");
                    controller.close();
                },
            }),
        );
    });
    app.post("/post", () => "x");
    return app;
}

describe("etag()", () => {
    test("GET の 2xx に、弱い ETag を付ける", async () => {
        const app = makeApp();
        for (const path of ["/text", "/c-text", "/json", "/array", "/bytes", "/response", "/empty", "/utf8", "/created", "/fast-stream"]) {
            const res = await app.fetch(req(path));

            expect(res.headers.get("etag"), path).toMatch(WEAK);
        }
    });

    test("本文はそのまま読める", async () => {
        const app = makeApp();

        expect(await (await app.fetch(req("/text"))).text()).toBe("hello");
        expect(await (await app.fetch(req("/fast-stream"))).text()).toBe("fast");
        expect(new Uint8Array(await (await app.fetch(req("/bytes"))).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("同じ本文なら同じ ETag。本文が変われば変わる", async () => {
        const app = makeApp();
        const tag = async (path: string) => (await app.fetch(req(path))).headers.get("etag");

        expect(await tag("/text")).toBe((await tag("/c-text"))!);
        expect(await tag("/text")).toBe((await tag("/response"))!);
        expect(await tag("/text")).not.toBe((await tag("/changed"))!);
    });

    test("weak: false なら、強い ETag", async () => {
        const res = await makeApp({ weak: false }).fetch(req("/text"));

        expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+-[0-9a-f]{16}"$/);
    });

    test("If-None-Match が合えば 304。本文がなく、ETag は残る", async () => {
        const app = makeApp();
        const tag = (await app.fetch(req("/text"))).headers.get("etag")!;
        const bare = tag.replace("W/", "");
        for (const value of [tag, bare, "*", `"other", ${tag}`, `"a","b" , ${bare}`]) {
            const res = await app.fetch(inm("/text", value));

            expect(res.status, value).toBe(304);
            expect(res.headers.get("etag")).toBe(tag);
            expect(res.headers.get("content-type")).toBeNull();
            expect(await res.text()).toBe("");
        }
    });

    test("If-None-Match が合わなければ 200", async () => {
        const app = makeApp();
        const res = await app.fetch(inm("/text", '"other"'));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hello");
    });

    test("304 は本文についてのヘッダーだけを消す", async () => {
        const app = makeApp();
        const tag = (await app.fetch(req("/headers"))).headers.get("etag")!;
        const res = await app.fetch(inm("/headers", tag));

        expect(res.status).toBe(304);
        expect(res.headers.get("cache-control")).toBe("max-age=60");
        expect(res.headers.get("x-mark")).toBe("1");
        expect(res.headers.get("x-res")).toBe("2");
        expect(res.headers.get("vary")).toBe("accept");
        expect(res.headers.getSetCookie().sort()).toEqual(["a=1", "b=2"]);
        expect(res.headers.get("content-type")).toBeNull();
        expect(res.headers.get("content-language")).toBeNull();
    });

    test("内側の cors() が付けたヘッダーは、304 にも残る", async () => {
        const app = createApp();
        app.use(etag());
        app.use(cors());
        app.get("/", () => "x");
        const headers = { origin: "https://a.example" };
        const tag = (await app.fetch(req("/", { headers }))).headers.get("etag")!;
        const res = await app.fetch(req("/", { headers: { ...headers, "if-none-match": tag } }));

        expect(res.status).toBe(304);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    test("付けないもの: POST、204、206、3xx、4xx、5xx", async () => {
        const app = makeApp();
        const cases: [Request, number][] = [
            [req("/post", { method: "POST" }), 200],
            [req("/no-content"), 204],
            [req("/partial"), 206],
            [req("/redirect"), 302],
            [req("/none"), 404],
            [req("/boom"), 500],
        ];
        for (const [request, status] of cases) {
            const res = await app.fetch(request);

            expect(res.status).toBe(status);
            expect(res.headers.get("etag")).toBeNull();
        }
        expect((await app.fetch(req("/post", { method: "POST", headers: { "if-none-match": "*" } }))).status).toBe(200);
    });

    test("HEAD には付けない。If-None-Match があっても 200", async () => {
        const app = makeApp();
        const res = await app.fetch(inm("/text", "*", "HEAD"));

        expect(res.status).toBe(200);
        expect(res.headers.get("etag")).toBeNull();
    });

    test("HEAD でも、自分で付けた ETag なら比べる", async () => {
        const app = makeApp();

        expect((await app.fetch(req("/own", { method: "HEAD" }))).headers.get("etag")).toBe('"mine"');
        expect((await app.fetch(inm("/own", '"mine"', "HEAD"))).status).toBe(304);
    });

    test("すでに ETag があれば、そのまま使う", async () => {
        const app = makeApp();

        expect((await app.fetch(req("/own"))).headers.get("etag")).toBe('"mine"');
        expect((await app.fetch(inm("/own", '"mine"'))).status).toBe(304);
        expect((await app.fetch(inm("/own", '"other"'))).status).toBe(200);
    });

    test("c.header() の ETag が最後に勝つ", async () => {
        const res = await makeApp().fetch(req("/own-header"));

        expect(res.headers.get("etag")).toBe('"by-header"');
    });

    test("1 MiB を超える本文には付けない", async () => {
        const res = await makeApp().fetch(req("/big"));

        expect(res.headers.get("etag")).toBeNull();
        expect((await res.text()).length).toBe(BIG.length);
    });

    test("遅いストリームには付けない。本文は最後まで読める", async () => {
        const start = performance.now();
        const res = await makeApp().fetch(req("/slow"));

        expect(res.headers.get("etag")).toBeNull();
        expect(performance.now() - start).toBeLessThan(30);
        expect(await res.text()).toBe("slow");
    });

    test("text/event-stream は読まない(大文字小文字を問わない)", async () => {
        const res = await makeApp().fetch(req("/sse"));

        expect(res.headers.get("etag")).toBeNull();
    });

    test("エラーになるストリームや、バイト列でないストリームでも壊れない", async () => {
        const app = makeApp();
        for (const path of ["/broken", "/strings"]) {
            const res = await app.fetch(req(path));

            expect(res.status, path).toBe(200);
            expect(res.headers.get("etag"), path).toBeNull();
        }
    });

    test("ハンドラーは毎回動く", async () => {
        let count = 0;
        const app = createApp();
        app.use(etag());
        app.get("/", () => {
            count++;
            return "x";
        });
        const tag = (await app.fetch(req("/"))).headers.get("etag")!;

        expect((await app.fetch(inm("/", tag))).status).toBe(304);
        expect(count).toBe(2);
    });

    test("外側の利用者のミドルウェアは、ETag の付いた本物の Response を受け取る", async () => {
        let seen: [boolean, string | null] | undefined;
        const look: Middleware = async (_c, next) => {
            const res = await next();
            seen = [Object.getPrototypeOf(res) === Response.prototype, res.headers.get("etag")];
            return res;
        };
        const app = createApp();
        app.use(look);
        app.use(etag());
        app.get("/", () => "x");
        await app.fetch(req("/"));

        expect(seen?.[0]).toBe(true);
        expect(seen?.[1]).toMatch(WEAK);
    });

    test("ヘッダーを変更できないレスポンスにも付けられる", async () => {
        const app = createApp();
        app.use(etag());
        app.get("/", () => fetch("data:text/plain,hello"));

        const res = await app.fetch(req("/"));
        expect(res.headers.get("etag")).toMatch(WEAK);
        expect(await res.text()).toBe("hello");
    });

    test("開発モードでも動く", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.use(etag());
        app.get("/", () => "x");
        const local = { host: "localhost" };
        const tag = (await app.fetch(req("/", { headers: local }))).headers.get("etag")!;

        expect(tag).toMatch(WEAK);
        expect((await app.fetch(req("/", { headers: { ...local, "if-none-match": tag } }))).status).toBe(304);
    });

    test("名前と印", () => {
        const middleware = etag();

        expect(middleware.name).toBe("etag");
        expect(isPlainSafe(middleware)).toBe(true);
    });
});

describe("serveStatic() と一緒に使う", () => {
    let dir = "";
    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "senri-etag-"));
        await writeFile(join(dir, "a.txt"), "static");
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    test("serveStatic() の ETag をそのまま使う", async () => {
        const app = createApp();
        app.use(etag());
        app.use(serveStatic({ root: dir }));
        const res = await app.fetch(req("/a.txt"));
        const tag = res.headers.get("etag")!;

        expect(tag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
        expect(tag).not.toMatch(WEAK);
        expect(await res.text()).toBe("static");

        const again = await app.fetch(inm("/a.txt", tag));
        expect(again.status).toBe(304);
        expect(again.headers.get("etag")).toBe(tag);
    });
});

describe("peekBody()", () => {
    test("全部読めたら中身を返す。元のレスポンスは読める", async () => {
        const res = new Response("hello");

        expect(new TextDecoder().decode((await peekBody(res, 10)) as Uint8Array)).toBe("hello");
        expect(await res.text()).toBe("hello");
    });

    test("limit を超えたら large。ちょうどなら中身", async () => {
        expect(await peekBody(new Response("hello"), 4)).toBe("large");
        expect(await peekBody(new Response("hello"), 5)).toBeInstanceOf(Uint8Array);
    });

    test("large のあとも、元のレスポンスは読める", async () => {
        const res = new Response("hello");

        await peekBody(res, 1);
        expect(await res.text()).toBe("hello");
    });

    test("本文がない、遅い、読み終えた本文なら null", async () => {
        const used = new Response("hello");
        await used.text();

        expect(await peekBody(new Response(null), 10)).toBeNull();
        expect(await peekBody(new Response(slowStream()), 10)).toBeNull();
        expect(await peekBody(used, 10)).toBeNull();
    });

    test("空の本文は、空の中身", async () => {
        expect(await peekBody(new Response(""), 10)).toEqual(new Uint8Array(0));
    });
});

describe("etag() とバンドル", () => {
    test("etag だけなら、Context が入らない", async () => {
        expect(await bundleOf("etag")).not.toContain(CONTEXT_MARKER);
    });

    test("使わなければ、本体に入らない", async () => {
        const code = await bundleOf("createApp");

        expect(code).toContain(CONTEXT_MARKER);
        expect(code).not.toContain("if-none-match");
    });
});
