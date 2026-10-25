import { describe, expect, test } from "bun:test";
import { createApp, HttpError } from "../../src/index.ts";
import { PAGE_HTML } from "../../src/dev/page.generated.ts";
import type { ErrorPageData } from "../../src/dev/page-data.ts";

const html = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);

// ページに埋め込まれた JSON を取り出す
async function pageData(res: Response): Promise<ErrorPageData> {
    const body = await res.text();
    const m = /<script type="application\/json" id="senri-data">([\s\S]*?)<\/script>/.exec(body);
    if (!m) throw new Error("エラーページではありません:\n" + body.slice(0, 200));
    return JSON.parse(m[1]!);
}

function boomApp(options = { dev: true }) {
    const app = createApp(options);
    app.use(async function logger(_c, next) {
        await next();
    });
    app.get("/boom", () => {
        throw new Error("わざと壊した");
    });
    return app;
}

describe("HTML のエラーページを返す条件", () => {
    test("開発モード + Accept: text/html + 500 なら HTML", async () => {
        const res = await boomApp().fetch(req("/boom", { headers: html }));

        expect(res.status).toBe(500);
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect((await pageData(res)).error).toEqual({ name: "Error", message: "わざと壊した" });
    });

    test("Accept が */* だけ(curl や fetch の既定)なら、今までどおりテキスト", async () => {
        const res = await boomApp().fetch(req("/boom", { headers: { accept: "*/*" } }));

        expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(await res.text()).toBe("500 Internal Server Error: わざと壊した");
    });

    test("本番では、Accept: text/html でも今までどおり", async () => {
        const res = await boomApp({ dev: false }).fetch(req("/boom", { headers: html }));

        expect(await res.text()).toBe("500 Internal Server Error");
    });

    test("意図して投げた 4xx の HttpError は、今までどおりテキスト", async () => {
        const app = createApp({ dev: true });
        app.get("/secret", () => {
            throw new HttpError(403, "見せられません");
        });

        const res = await app.fetch(req("/secret", { headers: html }));

        expect(res.status).toBe(403);
        expect(await res.text()).toBe("見せられません");
    });

    test("5xx の HttpError はページになり、本番で返る文言は message", async () => {
        const app = createApp({ dev: true });
        app.get("/down", () => {
            throw new HttpError(503, "メンテナンス中");
        });

        const res = await app.fetch(req("/down", { headers: html }));
        const data = await pageData(res);

        expect(res.status).toBe(503);
        expect(data.status).toBe(503);
        expect(data.production).toBe("メンテナンス中");
    });

    test("自分で onError を書いたら、そちらが使われる", async () => {
        const app = boomApp();
        app.onError(() => "自分のエラー");

        const res = await app.fetch(req("/boom", { headers: html }));

        expect(await res.text()).toBe("自分のエラー");
    });

    test("HEAD ではボディを返さない", async () => {
        const app = createApp({ dev: true });
        app.get("/boom", () => {
            throw new Error("x");
        });

        const res = await app.fetch(req("/boom", { method: "HEAD", headers: html }));

        expect(res.status).toBe(500);
        expect(await res.text()).toBe("");
    });
});

describe("ページの中身", () => {
    test("利用者のコードの場所・該当コード・ヒント・通った順番・リクエストが入る", async () => {
        const res = await boomApp().fetch(
            req("/boom", { headers: { ...html, "user-agent": "test-agent" } }),
        );
        const data = await pageData(res);

        expect(data.location!.file).toEndWith("test/dev/error-page.test.ts");
        expect(data.location!.display).toBe("test/dev/error-page.test.ts");
        expect(data.code!.lines.find((l) => l.hit)!.code).toContain('throw new Error("わざと壊した")');
        expect(data.hint!.text).toContain("HttpError");
        // ページはミドルウェアを全部通ったあとに組み立てるので、外側の logger の時間も入る
        expect(data.layers.map((l) => [l.name, l.failed])).toEqual([
            ["logger", false],
            ["handler", true],
        ]);
        expect(data.durationMs).toBeGreaterThanOrEqual(0);
        expect(data.request).toEqual({
            method: "GET",
            path: "/boom",
            route: "/boom",
            params: {},
            userAgent: "test-agent",
        });
        expect(data.frames.some((f) => f.kind === "senri")).toBe(true);
        expect(data.production).toBe("500 Internal Server Error");
    });

    test("メッセージに </script> があっても、ページの script は増えない(XSS)", async () => {
        const app = createApp({ dev: true });
        app.get("/xss", () => {
            throw new Error("</script><script>alert(1)</script>");
        });

        const res = await app.fetch(req("/xss", { headers: html }));
        const body = await res.text();

        expect(body.split("<script").length).toBe(PAGE_HTML.split("<script").length);
        expect(body).not.toContain("<script>alert(1)");
    });
});

describe("返した値をレスポンスにできなかったとき", () => {
    test("ハンドラーが返した値: ミドルウェアの行ではなく、どのハンドラーが返したかを出す", async () => {
        const app = boomApp();
        app.get("/big", () => ({ n: 1n }));

        const data = await pageData(await app.fetch(req("/big", { headers: html })));

        expect(data.origin).toEqual({ kind: "handler", name: "GET /big" });
        // logger の `await next()` の行を「エラーの場所」として出さない
        expect(data.location).toBeNull();
        expect(data.code).toBeNull();
        expect(data.hint!.text).toContain("BigInt");
    });

    test("ミドルウェアが返した値", async () => {
        const app = createApp({ dev: true });
        app.use(async function logger(_c, next) {
            await next();
        });
        app.use(function cache() {
            return { n: 1n };
        });
        app.get("/x", () => "x");

        const data = await pageData(await app.fetch(req("/x", { headers: html })));

        expect(data.origin).toEqual({ kind: "middleware", name: "cache" });
        expect(data.location).toBeNull();
    });

    test("ハンドラーの中で c.json() を呼んで失敗したなら、ハンドラーの行を場所として出す", async () => {
        const app = boomApp();
        app.get("/json", (_, c) => c.json({ n: 1n }));

        const data = await pageData(await app.fetch(req("/json", { headers: html })));

        expect(data.origin).toBeNull();
        expect(data.location!.file).toEndWith("test/dev/error-page.test.ts");
    });

    test("onError には、元のエラーがそのまま届く", async () => {
        const app = createApp({ dev: true });
        let received: unknown;
        app.onError((err) => {
            received = err;
            return "x";
        });
        app.get("/big", () => ({ n: 1n }));

        await app.fetch(req("/big"));

        expect(received).toBeInstanceOf(TypeError);
        expect((received as Error).message).toMatch(/BigInt/);
    });
});

describe("ミドルウェアが next() のあとで変えたものを引き継ぐ", () => {
    test("c.header() と Set-Cookie", async () => {
        const app = boomApp();
        app.use(async (c, next) => {
            await next();
            c.header("x-request-id", "abc");
            c.header("set-cookie", "a=1");
            c.header("set-cookie", "b=2");
        });

        const res = await app.fetch(req("/boom", { headers: html }));

        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(res.headers.get("x-request-id")).toBe("abc");
        expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    });

    test("返ってきた Response のヘッダーを直接書き換えたもの", async () => {
        const app = boomApp();
        app.use(async (_c, next) => {
            const res = await next();
            res.headers.set("x-from-middleware", "1");
            return res;
        });

        const res = await app.fetch(req("/boom", { headers: html }));

        expect(res.headers.get("x-from-middleware")).toBe("1");
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    });

    test("Response を作り直してステータスを変えたもの", async () => {
        const app = boomApp();
        app.use(async (_c, next) => {
            const res = await next();
            return new Response(res.body, { status: 503, headers: res.headers });
        });

        const res = await app.fetch(req("/boom", { headers: html }));

        expect(res.status).toBe(503);
        expect((await pageData(res)).status).toBe(503);
    });

    test("ミドルウェアが自分のレスポンスに差し替えたら、そちらを返す", async () => {
        const app = boomApp();
        app.use(async (_c, next) => {
            await next();
            return new Response("差し替え", { status: 502 });
        });

        const res = await app.fetch(req("/boom", { headers: html }));

        expect(res.status).toBe(502);
        expect(await res.text()).toBe("差し替え");
    });

    test("目印の内部ヘッダーは、どの場合も外に出ない", async () => {
        const app = boomApp();
        app.use(async (_c, next) => {
            const res = await next();
            // テキストのまま返すように、ボディだけ差し替えて内部ヘッダーはそのまま
            return new Response("差し替え", { status: res.status, headers: res.headers });
        });

        const res = await app.fetch(req("/boom", { headers: html }));

        for (const [name] of res.headers) expect(name).not.toStartWith("x-senri");
    });
});
