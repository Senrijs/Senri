import { describe, expect, test } from "bun:test";
import { compress, cors, createApp, etag, prettyJSON, type PrettyJSONOptions } from "../src/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf } from "./bundle.ts";

const PRETTY = '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}';
const COMPACT = '{"a":1,"b":[2]}';
const json = (body: BodyInit | null, type = "application/json", status = 200) => new Response(body, { status, headers: { "content-type": type } });

function makeApp(options?: PrettyJSONOptions) {
    const app = createApp();
    app.use(prettyJSON(options));
    app.get("/object", () => ({ a: 1, b: [2] }));
    app.get("/array", () => [1]);
    app.get("/c-json", (_, c) => c.json({ a: 1, b: [2] }));
    app.get("/response", () => json(COMPACT));
    app.get("/problem", () => json(COMPACT, "application/problem+json; charset=utf-8"));
    app.get("/status", () => json(COMPACT, "application/json", 404));
    app.get("/text", () => "plain");
    app.get("/html", () => json(COMPACT, "text/html"));
    app.get("/jsonish", () => json(COMPACT, "application/jsonish"));
    app.get("/invalid", () => json("{not json"));
    app.get("/length", () => new Response(COMPACT, { headers: { "content-type": "application/json", "content-length": String(COMPACT.length) } }));
    app.get("/encoded", () => new Response("x", { headers: { "content-type": "application/json", "content-encoding": "gzip" } }));
    app.get("/big-object", () => ({ text: "x".repeat(1024 * 1024) }));
    app.get("/big-response", () => json(JSON.stringify({ text: "x".repeat(1024 * 1024) })));
    app.get("/slow", () => {
        return json(
            new ReadableStream({
                async start(controller) {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    controller.enqueue(new TextEncoder().encode(COMPACT));
                    controller.close();
                },
            }),
        );
    });
    app.get("/own", (_, c) => {
        c.header("x-own", "1");
        c.status(201);
        return { a: 1 };
    });
    return app;
}

const go = (app: ReturnType<typeof makeApp>, path: string, init?: RequestInit) => app.fetch(new Request(`http://localhost${path}`, init));
const text = async (app: ReturnType<typeof makeApp>, path: string) => (await go(app, path)).text();

describe("prettyJSON()", () => {
    test("?pretty があれば整形する", async () => {
        const app = makeApp();
        for (const path of ["/object", "/c-json", "/response"]) {
            expect(await text(app, `${path}?pretty`), path).toBe(PRETTY);
        }
        expect(await text(app, "/array?pretty")).toBe("[\n  1\n]");
    });

    test("なければ、そのまま", async () => {
        const app = makeApp();

        expect(await text(app, "/object")).toBe(COMPACT);
        expect(await text(app, "/response")).toBe(COMPACT);
        expect(await text(app, "/object?other=1")).toBe(COMPACT);
        expect(await text(app, "/object?prettyx")).toBe(COMPACT);
    });

    test("値は見ない", async () => {
        const app = makeApp();

        expect(await text(app, "/object?pretty=false")).toBe(PRETTY);
        expect(await text(app, "/object?a=1&pretty=1&b=2")).toBe(PRETTY);
    });

    test("+json の種類も整形する。Content-Type は変えない", async () => {
        const res = await go(makeApp(), "/problem?pretty");

        expect(await res.text()).toBe(PRETTY);
        expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    });

    test("ステータスを保つ", async () => {
        const res = await go(makeApp(), "/status?pretty");

        expect(res.status).toBe(404);
        expect(await res.text()).toBe(PRETTY);
    });

    test("c.status() と c.header() を保つ", async () => {
        const res = await go(makeApp(), "/own?pretty");

        expect(res.status).toBe(201);
        expect(res.headers.get("x-own")).toBe("1");
        expect(await res.text()).toBe('{\n  "a": 1\n}');
    });

    test("Content-Length を消す", async () => {
        const res = await go(makeApp(), "/length?pretty");

        expect(res.headers.get("content-length")).not.toBe(String(COMPACT.length));
        expect(await res.text()).toBe(PRETTY);
    });

    test("JSON でないものは、そのまま", async () => {
        const app = makeApp();

        expect(await text(app, "/text?pretty")).toBe("plain");
        expect(await text(app, "/html?pretty")).toBe(COMPACT);
        expect(await text(app, "/jsonish?pretty")).toBe(COMPACT);
    });

    test("読めない JSON は、そのまま", async () => {
        expect(await text(makeApp(), "/invalid?pretty")).toBe("{not json");
    });

    test("圧縮済みの本文は、そのまま", async () => {
        expect(await text(makeApp(), "/encoded?pretty")).toBe("x");
    });

    test("1 MiB を超える本文は、そのまま", async () => {
        const app = makeApp();
        const compact = JSON.stringify({ text: "x".repeat(1024 * 1024) });

        expect(await text(app, "/big-object?pretty")).toBe(compact);
        expect(await text(app, "/big-response?pretty")).toBe(compact);
    });

    test("遅いストリームは、そのまま読める", async () => {
        expect(await text(makeApp(), "/slow?pretty")).toBe(COMPACT);
    });

    test("HEAD でも壊れない", async () => {
        const res = await go(makeApp(), "/object?pretty", { method: "HEAD" });

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("");
    });

    test("space と query を変えられる", async () => {
        const app = makeApp({ space: 4, query: "indent" });

        expect(await text(app, "/array?indent")).toBe("[\n    1\n]");
        expect(await text(app, "/array?pretty")).toBe("[1]");
    });

    test("内側の純正のミドルウェアが足したヘッダーを保つ", async () => {
        const app = createApp();
        app.use(prettyJSON());
        app.use(cors());
        app.get("/", () => ({ a: 1 }));
        const res = await app.fetch(new Request("http://localhost/?pretty", { headers: { origin: "https://a.example" } }));

        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(await res.text()).toBe('{\n  "a": 1\n}');
    });

    test("compress() と etag() の内側に置くと、整形した本文に働く", async () => {
        const app = createApp();
        app.use(compress({ threshold: 1 }));
        app.use(etag());
        app.use(prettyJSON());
        app.get("/", () => ({ a: 1, b: [2] }));
        const res = await app.fetch(new Request("http://localhost/?pretty", { headers: { "accept-encoding": "gzip" } }));

        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(res.headers.get("etag")).toStartWith(`W/"${PRETTY.length.toString(16)}-`);
    });

    test.each([
        [{ space: 0 }],
        [{ space: 11 }],
        [{ space: 1.5 }],
        [{ space: "2" }],
        [{ query: "" }],
        [{ query: 1 }],
    ])("不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            prettyJSON(options as PrettyJSONOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err)).toContain("prettyJSON()");
    });

    test("名前と印", () => {
        const middleware = prettyJSON();

        expect(middleware.name).toBe("prettyJSON");
        expect(isPlainSafe(middleware)).toBe(true);
    });

    test("使わなければ、本体に入らない", async () => {
        expect(await bundleOf("createApp")).not.toContain("pretty");
    });
});
