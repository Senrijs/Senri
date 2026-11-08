import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";
import { compress, cors, createApp, etag, type Middleware } from "../src/index.ts";
import { serveStatic } from "../adapters/static/index.ts";
import { devtools } from "../src/dev/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf, CONTEXT_MARKER } from "./bundle.ts";

const BIG = "hello world ".repeat(200);
const req = (path: string, acceptEncoding: string | null = "gzip", init: RequestInit = {}) =>
    new Request(`http://localhost${path}`, { ...init, headers: { ...(acceptEncoding === null ? {} : { "accept-encoding": acceptEncoding }), ...(init.headers as object) } });

// 遅いストリームの代わり。release() を呼ぶまで本文を出さない(時間で待つと、遅いマシンで結果が変わる)
function gatedStream(text: string) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            await gate;
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        },
    });
    return { body, release };
}
const typed = (type: string, body: BodyInit | null = BIG, status = 200) => new Response(body, { status, headers: { "content-type": type } });

async function decoded(res: Response): Promise<string> {
    const bytes = new Uint8Array(await res.arrayBuffer());
    const encoding = res.headers.get("content-encoding");
    if (encoding === "gzip") return gunzipSync(bytes).toString();
    if (encoding === "deflate") return inflateSync(bytes).toString();
    return new TextDecoder().decode(bytes);
}

function appWith(handler: () => unknown, options?: Parameters<typeof compress>[0]) {
    const app = createApp();
    app.use(compress(options));
    app.all("/", handler as () => string);
    return app;
}

describe("compress()", () => {
    test("gzip で圧縮する。Content-Length を消して Vary を付ける", async () => {
        const res = await appWith(() => typed("text/plain", BIG)).fetch(req("/"));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(res.headers.get("vary")).toBe("Accept-Encoding");
        expect(res.headers.get("content-length")).toBeNull();
        expect(res.headers.get("content-type")).toBe("text/plain");
        expect(await decoded(res)).toBe(BIG);
    });

    test("deflate は zlib 形式(HTTP の deflate)", async () => {
        const res = await appWith(() => typed("text/plain", BIG)).fetch(req("/", "deflate"));

        expect(res.headers.get("content-encoding")).toBe("deflate");
        expect(inflateSync(new Uint8Array(await res.arrayBuffer())).toString()).toBe(BIG);
    });

    test("素の文字列、オブジェクト、c.text() も圧縮する", async () => {
        const app = createApp();
        app.use(compress());
        app.get("/string", () => BIG);
        app.get("/object", () => ({ text: BIG }));
        app.get("/c-text", (_, c) => c.text(BIG));

        expect(await decoded(await app.fetch(req("/string")))).toBe(BIG);
        expect(JSON.parse(await decoded(await app.fetch(req("/object"))))).toEqual({ text: BIG });
        expect(await decoded(await app.fetch(req("/c-text")))).toBe(BIG);
    });

    test.each([
        ["gzip", "gzip"],
        ["GZIP", "gzip"],
        ["deflate", "deflate"],
        ["gzip, deflate", "gzip"],
        ["deflate, gzip", "gzip"],
        ["gzip;q=0.5, deflate;q=0.8", "deflate"],
        ["gzip; q=0.5 , deflate ; q=0.8", "deflate"],
        ["gzip;q=0, deflate", "deflate"],
        ["gzip;q=1.0, deflate;q=0", "gzip"],
        ["*", "gzip"],
        ["gzip;q=0, *", "deflate"],
        ["gzip;q=0", null],
        ["GZIP;Q=0", null],
        ["*;q=0", null],
        ["gzip;q=0, deflate;q=0", null],
        ["gzip;q=abc", null],
        ["br", null],
        ["identity", null],
        ["", null],
        [null, null],
    ])("Accept-Encoding: %s → %s", async (header, expected) => {
        const res = await appWith(() => typed("text/plain")).fetch(req("/", header));

        expect(res.headers.get("content-encoding")).toBe(expected);
        expect(res.headers.get("vary")).toBe("Accept-Encoding");
        expect(await decoded(res)).toBe(BIG);
    });

    test("encoding で1つに決められる", async () => {
        const app = appWith(() => typed("text/plain"), { encoding: "deflate" });

        expect((await app.fetch(req("/", "gzip, deflate"))).headers.get("content-encoding")).toBe("deflate");
        expect((await app.fetch(req("/", "gzip"))).headers.get("content-encoding")).toBeNull();
    });

    test("threshold より小さい本文は圧縮しない。Vary も付けない", async () => {
        const app = appWith(() => typed("text/plain", "x".repeat(10)), { threshold: 11 });
        const res = await app.fetch(req("/"));

        expect(res.headers.get("content-encoding")).toBeNull();
        expect(res.headers.get("vary")).toBeNull();
        expect(await res.text()).toBe("x".repeat(10));
    });

    test("ちょうど threshold なら圧縮する", async () => {
        const res = await appWith(() => typed("text/plain", "x".repeat(10)), { threshold: 10 }).fetch(req("/"));

        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(await decoded(res)).toBe("x".repeat(10));
    });

    test("バイト数で数える(日本語)", async () => {
        const text = "あ".repeat(10);
        const app = createApp();
        app.use(compress({ threshold: 30 }));
        app.get("/", () => text);

        const res = await app.fetch(req("/"));
        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(await decoded(res)).toBe(text);
    });

    test.each([
        ["text/html; charset=utf-8", true],
        ["TEXT/PLAIN", true],
        ["text/css", true],
        ["application/json", true],
        ["application/json; charset=utf-8", true],
        ["application/problem+json", true],
        ["application/xml", true],
        ["application/rss+xml", true],
        ["application/javascript", true],
        ["application/wasm", true],
        ["image/svg+xml", true],
        ["text/event-stream", false],
        ["TEXT/EVENT-STREAM; charset=utf-8", false],
        ["image/png", false],
        ["application/zip", false],
        ["application/octet-stream", false],
        ["application/jsonish", false],
        ["video/mp4", false],
    ])("Content-Type: %s → 圧縮 %p", async (type, expected) => {
        const res = await appWith(() => typed(type)).fetch(req("/"));

        expect(res.headers.get("content-encoding")).toBe(expected ? "gzip" : null);
        expect(await decoded(res)).toBe(BIG);
    });

    test("Content-Type がなければ圧縮しない", async () => {
        const res = await appWith(() => new Uint8Array(5000)).fetch(req("/"));

        expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("圧縮しないもの: すでに Content-Encoding がある、no-transform", async () => {
        const cases: Record<string, string>[] = [{ "content-encoding": "br" }, { "cache-control": "public, no-transform" }, { "cache-control": "No-Transform" }];
        for (const headers of cases) {
            const res = await appWith(() => new Response(BIG, { headers: { "content-type": "text/plain", ...headers } })).fetch(req("/"));

            expect(res.headers.get("content-encoding")).toBe(headers["content-encoding"] ?? null);
            expect(await res.text()).toBe(BIG);
        }
    });

    test("no-transform と似た値では止めない", async () => {
        const res = await appWith(() => new Response(BIG, { headers: { "content-type": "text/plain", "cache-control": "no-transforming" } })).fetch(req("/"));

        expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("圧縮しないもの: HEAD、204、206、304", async () => {
        const head = await appWith(() => typed("text/plain")).fetch(req("/", "gzip", { method: "HEAD" }));
        expect(head.status).toBe(200);
        expect(head.headers.get("content-encoding")).toBeNull();

        for (const [status, body] of [[204, null], [206, BIG], [304, null]] as const) {
            const res = await appWith(() => typed("text/plain", body, status)).fetch(req("/"));

            expect(res.status).toBe(status);
            expect(res.headers.get("content-encoding")).toBeNull();
            expect(await res.text()).toBe(body ?? "");
        }
    });

    test("エラーのレスポンスも、大きければ圧縮する。ステータスは変わらない", async () => {
        const res = await appWith(() => typed("text/plain", BIG, 404)).fetch(req("/"));

        expect(res.status).toBe(404);
        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(await decoded(res)).toBe(BIG);
    });

    test("POST も圧縮する", async () => {
        const res = await appWith(() => typed("text/plain")).fetch(req("/", "gzip", { method: "POST" }));

        expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("ヘッダーを引き継ぐ。Set-Cookie は別々のまま。c.header() も足される", async () => {
        const app = createApp();
        app.use(compress());
        app.get("/", (_, c) => {
            c.header("x-own", "1");
            c.header("set-cookie", "c=3");
            const res = typed("text/plain");
            res.headers.append("set-cookie", "a=1");
            res.headers.append("set-cookie", "b=2");
            return res;
        });
        const res = await app.fetch(req("/"));

        expect(res.headers.get("x-own")).toBe("1");
        expect(res.headers.getSetCookie().sort()).toEqual(["a=1", "b=2", "c=3"]);
    });

    test("既存の Vary に足す。* はそのまま", async () => {
        const make = (vary: string) => () => new Response(BIG, { headers: { "content-type": "text/plain", vary } });

        expect((await appWith(make("Origin")).fetch(req("/"))).headers.get("vary")).toBe("Origin, Accept-Encoding");
        expect((await appWith(make("accept-encoding")).fetch(req("/"))).headers.get("vary")).toBe("accept-encoding");
        expect((await appWith(make("*")).fetch(req("/"))).headers.get("vary")).toBe("*");
    });

    test("内側の cors() のヘッダーは残る", async () => {
        const app = createApp();
        app.use(compress());
        app.use(cors());
        app.get("/", () => BIG);
        const res = await app.fetch(req("/", "gzip", { headers: { origin: "https://a.example" } }));

        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("強い ETag は弱くする。弱い ETag はそのまま", async () => {
        const make = (tag: string) => () => new Response(BIG, { headers: { "content-type": "text/plain", etag: tag } });

        expect((await appWith(make('"abc"')).fetch(req("/"))).headers.get("etag")).toBe('W/"abc"');
        expect((await appWith(make('W/"abc"')).fetch(req("/"))).headers.get("etag")).toBe('W/"abc"');
        // 圧縮しないときは変えない
        expect((await appWith(make('"abc"')).fetch(req("/", null))).headers.get("etag")).toBe('"abc"');
    });

    test("etag() と一緒に使う", async () => {
        const app = createApp();
        app.use(compress());
        app.use(etag());
        app.get("/", () => BIG);

        const gzip = await app.fetch(req("/"));
        const plain = await app.fetch(req("/", null));
        const tag = gzip.headers.get("etag")!;

        expect(tag).toStartWith('W/"');
        expect(plain.headers.get("etag")).toBe(tag);
        expect(await decoded(gzip)).toBe(BIG);

        const again = await app.fetch(req("/", "gzip", { headers: { "if-none-match": tag } }));
        expect(again.status).toBe(304);
        expect(again.headers.get("content-encoding")).toBeNull();
        expect(again.headers.get("etag")).toBe(tag);
    });

    test("Content-Length があれば、それで判断する", async () => {
        const small = await appWith(() => new Response("x", { headers: { "content-type": "text/plain", "content-length": "1" } })).fetch(req("/"));
        const big = await appWith(() => new Response(BIG, { headers: { "content-type": "text/plain", "content-length": String(BIG.length) } })).fetch(req("/"));

        expect(small.headers.get("content-encoding")).toBeNull();
        expect(small.headers.get("content-length")).toBe("1");
        expect(big.headers.get("content-encoding")).toBe("gzip");
        expect(big.headers.get("content-length")).toBeNull();
        expect(await decoded(big)).toBe(BIG);
    });

    test("遅いストリームは圧縮しない。本文は最後まで読める", async () => {
        // 本文はまだ出ていない(時間で待つと、遅いマシンでは compress() の様子見のうちに届いてしまう)
        const slow = gatedStream(BIG);
        const res = await appWith(() => typed("text/plain", slow.body)).fetch(req("/"));

        expect(res.headers.get("content-encoding")).toBeNull();
        expect(res.headers.get("vary")).toBeNull();
        slow.release();
        expect(await res.text()).toBe(BIG);
    });

    test("すぐ読めるストリームは、大きければ圧縮する", async () => {
        const res = await appWith(() =>
            typed(
                "text/plain",
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(BIG));
                        controller.close();
                    },
                }),
            ),
        ).fetch(req("/"));

        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(await decoded(res)).toBe(BIG);
    });

    test("ヘッダーを変更できないレスポンスも圧縮できる", async () => {
        const app = createApp();
        app.use(compress({ threshold: 1 }));
        app.get("/", () => fetch("data:text/plain,hello"));

        const res = await app.fetch(req("/"));
        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(await decoded(res)).toBe("hello");
    });

    test("外側の利用者のミドルウェアは、本物の Response を受け取る", async () => {
        let real = false;
        const look: Middleware = async (_c, next) => {
            const res = await next();
            real = Object.getPrototypeOf(res) === Response.prototype;
            return res;
        };
        const app = createApp();
        app.use(look);
        app.use(compress());
        app.get("/", () => BIG);
        await app.fetch(req("/"));

        expect(real).toBe(true);
    });

    test("開発モードでも動く", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.use(compress());
        app.get("/", () => BIG);

        const res = await app.fetch(req("/", "gzip", { headers: { host: "localhost" } }));
        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(await decoded(res)).toBe(BIG);
    });

    test("設定が不正なら、作るときに投げる。開発モードの説明がある", () => {
        const errorOf = (options: object) => {
            try {
                compress(options as never);
            } catch (err) {
                return err;
            }
            return undefined;
        };
        for (const threshold of [-1, Number.NaN, "1024"]) expect(explainText(errorOf({ threshold }), "ja")).toContain("threshold");
        for (const encoding of ["br", "", "GZIP"]) expect(explainText(errorOf({ encoding }), "ja")).toContain("encoding");
    });

    test("名前と印", () => {
        const middleware = compress();

        expect(middleware.name).toBe("compress");
        expect(isPlainSafe(middleware)).toBe(true);
    });
});

describe("serveStatic() と一緒に使う", () => {
    let dir = "";
    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "senri-compress-"));
        await writeFile(join(dir, "big.txt"), BIG);
        await writeFile(join(dir, "small.txt"), "small");
        await writeFile(join(dir, "image.png"), BIG);
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    test("大きいファイルは圧縮する。Content-Length を消す", async () => {
        const app = createApp();
        app.use(compress());
        app.use(serveStatic({ root: dir }));
        const res = await app.fetch(req("/big.txt"));

        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(res.headers.get("content-length")).toBeNull();
        expect(res.headers.get("etag")).toStartWith('W/"');
        expect(await decoded(res)).toBe(BIG);
    });

    test("小さいファイルと、圧縮が効かない種類はそのまま", async () => {
        const app = createApp();
        app.use(compress());
        app.use(serveStatic({ root: dir }));

        const small = await app.fetch(req("/small.txt"));
        expect(small.headers.get("content-encoding")).toBeNull();
        expect(small.headers.get("content-length")).toBe("5");
        expect(await small.text()).toBe("small");

        const image = await app.fetch(req("/image.png"));
        expect(image.headers.get("content-encoding")).toBeNull();
        expect(image.headers.get("content-length")).toBe(String(BIG.length));
        expect(await image.text()).toBe(BIG);
    });

    test("304 と HEAD はそのまま", async () => {
        const app = createApp();
        app.use(compress());
        app.use(serveStatic({ root: dir }));

        const again = await app.fetch(req("/big.txt", "gzip", { headers: { "if-none-match": "*" } }));
        expect(again.status).toBe(304);
        expect(again.headers.get("content-encoding")).toBeNull();

        const head = await app.fetch(req("/big.txt", "gzip", { method: "HEAD" }));
        expect(head.headers.get("content-encoding")).toBeNull();
        expect(head.headers.get("content-length")).toBe(String(BIG.length));
    });
});

describe("compress() とバンドル", () => {
    test("compress だけなら、Context が入らない", async () => {
        expect(await bundleOf("compress")).not.toContain(CONTEXT_MARKER);
    });

    test("使わなければ、本体に入らない", async () => {
        const code = await bundleOf("createApp");

        expect(code).toContain(CONTEXT_MARKER);
        expect(code).not.toContain("CompressionStream");
    });
});
