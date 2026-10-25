import { describe, expect, test } from "bun:test";
import { createApp, HttpError } from "../src/index.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

// 全部のリクエストに CORS ヘッダーを付けるミドルウェアがあるアプリ
function appWithCors() {
    const app = createApp();
    app.use((c, next) => {
        c.header("access-control-allow-origin", "*");
        return next();
    });
    return app;
}

describe("c.header() はどんな返し方でも効く", () => {
    test("ハンドラーが Response を直接返したとき", async () => {
        const app = appWithCors();
        app.get("/raw", () => new Response("raw"));

        const res = await app.fetch(req("/raw"));

        expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    test("404 / 405 / 500 / HttpError のとき", async () => {
        const app = appWithCors();
        app.get("/boom", () => {
            throw new Error("boom");
        });
        app.get("/forbidden", () => {
            throw new HttpError(403, "だめ");
        });

        for (const [path, method] of [["/nope", "GET"], ["/boom", "POST"], ["/boom", "GET"], ["/forbidden", "GET"]]) {
            const res = await app.fetch(req(path!, { method }));
            expect(res.headers.get("access-control-allow-origin")).toBe("*");
        }
    });

    test("next() のあとに設定しても効く", async () => {
        const app = createApp();
        app.use(async (c, next) => {
            await next();
            c.header("server-timing", "app;dur=1");
        });
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x"));

        expect(res.headers.get("server-timing")).toBe("app;dur=1");
    });

    test("ヘッダーが変更できない Response(Response.redirect)でも効く", async () => {
        const app = appWithCors();
        app.get("/go", () => Response.redirect("http://localhost/hello", 302));

        const res = await app.fetch(req("/go"));

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("http://localhost/hello");
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
});

describe("マージのルール", () => {
    test("Content-Type はレスポンス自身のものが優先", async () => {
        const app = createApp();
        app.get("/xml", (_, c) => {
            c.header("content-type", "text/html");
            return new Response("<a/>", { headers: { "content-type": "application/xml" } });
        });

        const res = await app.fetch(req("/xml"));

        expect(res.headers.get("content-type")).toBe("application/xml");
    });

    test("Set-Cookie は上書きせずに足す", async () => {
        const app = createApp();
        app.use((c, next) => {
            c.header("set-cookie", "a=1");
            c.header("set-cookie", "b=2");
            return next();
        });
        app.get("/x", () => new Response("x", { headers: { "set-cookie": "c=3" } }));

        const res = await app.fetch(req("/x"));

        expect(res.headers.getSetCookie().sort()).toEqual(["a=1", "b=2", "c=3"]);
    });

    test("c.status() は Response を直接返したときには効かない", async () => {
        const app = createApp();
        app.get("/x", (_, c) => {
            c.status(201);
            return new Response("x", { status: 202 });
        });

        const res = await app.fetch(req("/x"));

        expect(res.status).toBe(202);
    });

    test("c.header() を使っていなければ、Response はそのまま返る(作り直さない)", async () => {
        const app = createApp();
        const original = new Response("x");
        app.get("/x", () => original);

        const res = await app.fetch(req("/x"));

        expect(res).toBe(original);
    });
});

describe("ハンドラーの戻り値", () => {
    test("Blob はそのままボディになる(JSON にしない)", async () => {
        const app = createApp();
        app.get("/b", () => new Blob(["hello"], { type: "image/png" }));

        const res = await app.fetch(req("/b"));

        expect(await res.text()).toBe("hello");
        expect(res.headers.get("content-type")).toBe("image/png");
    });

    test("Uint8Array / ArrayBuffer / ReadableStream もそのままボディになる", async () => {
        const app = createApp();
        app.get("/u8", () => new TextEncoder().encode("u8"));
        app.get("/ab", () => new TextEncoder().encode("ab").buffer);
        app.get("/rs", () => new Blob(["rs"]).stream());

        for (const name of ["u8", "ab", "rs"]) {
            const res = await app.fetch(req(`/${name}`));
            expect(await res.text()).toBe(name);
        }
    });

    test("URLSearchParams はフォームの形式になる", async () => {
        const app = createApp();
        app.get("/q", () => new URLSearchParams({ a: "1" }));

        const res = await app.fetch(req("/q"));

        expect(await res.text()).toBe("a=1");
        expect(res.headers.get("content-type")).toStartWith("application/x-www-form-urlencoded");
    });

    test("関数を返したら、呼び忘れとして 500 になる", async () => {
        const app = createApp({ dev: true });
        app.get("/f", () => (() => 1) as never);

        const res = await app.fetch(req("/f"));

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("関数");
    });

    test("undefined を返したら 500 になる(JS から使ったときなど)", async () => {
        const app = createApp({ dev: true });
        app.get("/u", () => undefined as never);

        const res = await app.fetch(req("/u"));

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("何も返していません");
    });
});

describe("c.json() と c.text()", () => {
    test("文字列を返すと text/plain; charset=utf-8 になる(どのランタイムでも同じ)", async () => {
        const app = createApp();
        app.get("/t", () => "こんにちは");

        const res = await app.fetch(req("/t"));

        expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    });

    test("c.header() で Content-Type を決めていれば、そちらが使われる", async () => {
        const app = createApp();
        app.get("/h", (_, c) => {
            c.header("content-type", "text/html; charset=utf-8");
            return "<p>hi</p>";
        });

        const res = await app.fetch(req("/h"));

        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    });

    test("c.json() のあとに c.text() しても Content-Type が混ざらない", async () => {
        const app = createApp();
        app.use(async (c, next) => {
            await next();
            return c.text("上書き");
        });
        app.get("/j", (_, c) => c.json({ a: 1 }));

        const res = await app.fetch(req("/j"));

        expect(await res.text()).toBe("上書き");
        expect(res.headers.get("content-type") ?? "").not.toContain("application/json");
    });
});
