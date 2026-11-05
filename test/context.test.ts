import { describe, expect, test } from "bun:test";
import { Context, createApp, HttpError } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { setCookie } from "../src/cookie.ts";

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

    test("Location はレスポンス自身のものが優先", async () => {
        const app = createApp();
        app.get("/x", (_, c) => {
            c.header("location", "/from-header");
            return new Response(null, { status: 302, headers: { location: "/from-response" } });
        });

        const res = await app.fetch(req("/x"));

        expect(res.headers.get("location")).toBe("/from-response");
    });

    test("レスポンスに Location がなければ、c.header() の Location が付く", async () => {
        const app = createApp();
        app.get("/x", (_, c) => {
            c.header("location", "/from-header");
            return new Response(null, { status: 302 });
        });
        app.get("/error", () => {
            throw new HttpError(302, "moved", { headers: { location: "/from-error" } });
        });

        expect((await app.fetch(req("/x"))).headers.get("location")).toBe("/from-header");

        const error = await app.fetch(req("/error"));
        expect(error.status).toBe(302);
        expect(error.headers.get("location")).toBe("/from-error");
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
        const app = createApp({ dev: devtools() });
        app.get("/f", () => (() => 1) as never);

        const res = await app.fetch(req("/f"));

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("関数");
    });

    test("undefined を返したら 500 になる(JS から使ったときなど)", async () => {
        const app = createApp({ dev: devtools() });
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

describe("c.html()", () => {
    test("text/html; charset=utf-8 で返す", async () => {
        const app = createApp();
        app.get("/h", (_, c) => c.html("<h1>こんにちは</h1>"));

        const res = await app.fetch(req("/h"));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(await res.text()).toBe("<h1>こんにちは</h1>");
    });

    test("status は引数、なければ c.status() を使う", async () => {
        const app = createApp();
        app.get("/arg", (_, c) => c.status(403).html("x", 201));
        app.get("/status", (_, c) => c.status(403).html("x"));

        expect((await app.fetch(req("/arg"))).status).toBe(201);
        expect((await app.fetch(req("/status"))).status).toBe(403);
    });

    test("c.header() で Content-Type を決めていれば、そちらが使われる", async () => {
        const app = createApp();
        app.get("/h", (_, c) => {
            c.header("content-type", "application/xhtml+xml");
            return c.html("<p/>");
        });

        const res = await app.fetch(req("/h"));

        expect(res.headers.get("content-type")).toBe("application/xhtml+xml");
    });

    test("c.json() / c.text() と Content-Type が混ざらない", async () => {
        const app = createApp();
        app.use(async (c, next) => {
            await next();
            return c.html("<p>上書き</p>");
        });
        app.get("/j", (_, c) => c.json({ a: 1 }));
        app.get("/t", (_, c) => c.text("t"));

        for (const path of ["/j", "/t"]) {
            const res = await app.fetch(req(path));
            expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        }
    });

    test("c.header() のほかのヘッダーも付く", async () => {
        const app = createApp();
        app.get("/h", (_, c) => {
            c.header("x-mark", "1");
            return c.html("<p/>");
        });

        const res = await app.fetch(req("/h"));

        expect(res.headers.get("x-mark")).toBe("1");
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    });
});

describe("c.redirect()", () => {
    // ハンドラーで c.redirect() を呼んだ結果
    function redirect(...args: Parameters<Context["redirect"]>) {
        const app = createApp();
        app.get("/go", (_, c) => c.redirect(...args));
        return app.fetch(req("/go"));
    }
    // c.redirect() が投げるエラー
    function thrown(...args: Parameters<Context["redirect"]>): Error & { code?: string } {
        try {
            new Context(req("/")).redirect(...args);
        } catch (err) {
            return err as Error & { code?: string };
        }
        throw new Error("投げなかった");
    }

    test("既定は 302 で、本文はない", async () => {
        const res = await redirect("/login");

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/login");
        expect(res.headers.get("content-type")).toBeNull();
        expect(res.body).toBeNull();
    });

    test.each([301, 302, 303, 307, 308] as const)("status %d を使える", async (status) => {
        const res = await redirect("/x", status);

        expect(res.status).toBe(status);
        expect(res.headers.get("location")).toBe("/x");
    });

    test("ASCII だけの値は、変えずに Location に入れる", async () => {
        for (const location of ["/login?next=%2Fa&x=1#f", "../up", "?page=2", "//example.com/a", "https://example.com", "HTTPS://EXAMPLE.com/a%20b"]) {
            expect((await redirect(location)).headers.get("location")).toBe(location);
        }
    });

    test("c.status() は見ない", async () => {
        const app = createApp();
        app.get("/go", (_, c) => c.status(404).redirect("/x"));

        expect((await app.fetch(req("/go"))).status).toBe(302);
    });

    test("ログイン後のリダイレクトで Cookie が付く", async () => {
        const app = createApp();
        app.post("/login", (_, c) => {
            setCookie(c, "session", "abc");
            setCookie(c, "seen", "1");
            c.header("x-mark", "1");
            return c.redirect("/dashboard", 303);
        });

        const res = await app.fetch(req("/login", { method: "POST" }));

        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/dashboard");
        expect(res.headers.get("x-mark")).toBe("1");
        expect(res.headers.getSetCookie()).toEqual([
            "session=abc; Path=/; HttpOnly; SameSite=Lax",
            "seen=1; Path=/; HttpOnly; SameSite=Lax",
        ]);
    });

    test("c.header() の Location より、c.redirect() の値が優先", async () => {
        const app = createApp();
        app.use((c, next) => {
            c.header("location", "/from-middleware");
            return next();
        });
        app.get("/go", (_, c) => c.redirect("/from-redirect"));

        const res = await app.fetch(req("/go"));

        expect(res.headers.get("location")).toBe("/from-redirect");
    });

    test("ミドルウェアから返せる", async () => {
        const app = createApp();
        app.use("/admin", (c) => {
            setCookie(c, "from", "admin");
            return c.redirect("/login");
        });
        app.get("/admin", () => "ここには来ない");

        const res = await app.fetch(req("/admin"));

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/login");
        expect(res.headers.getSetCookie()).toHaveLength(1);
    });

    test("HEAD でも Location と Cookie が付く", async () => {
        const app = createApp();
        app.get("/go", (_, c) => {
            setCookie(c, "a", "1");
            return c.redirect("/x");
        });

        const res = await app.fetch(req("/go", { method: "HEAD" }));

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/x");
        expect(res.headers.getSetCookie()).toHaveLength(1);
    });

    test("実際のサーバー(Bun.serve)でも、相対パスと Cookie がそのまま届く", async () => {
        const app = createApp();
        app.get("/login", (_, c) => {
            setCookie(c, "session", "abc");
            setCookie(c, "seen", "1");
            return c.redirect("/日本語?next=/a", 303);
        });
        const server = Bun.serve({ port: 0, fetch: (r, s) => app.fetch(r, s) });
        try {
            const res = await fetch(new URL("/login", server.url), { redirect: "manual" });

            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/%E6%97%A5%E6%9C%AC%E8%AA%9E?next=/a");
            expect(res.headers.getSetCookie()).toHaveLength(2);
        } finally {
            await server.stop(true);
        }
    });

    describe("ASCII 以外", () => {
        test("相対パスは、ASCII 以外の部分だけパーセントエンコードする", async () => {
            const cases: [string, string][] = [
                ["/日本語", "/%E6%97%A5%E6%9C%AC%E8%AA%9E"],
                ["/é", "/%C3%A9"],
                ["/日本語?q=あ&r=1#é", "/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%E3%81%82&r=1#%C3%A9"],
                // すでにエンコードされた部分は、二重にしない
                ["/a%2Fb?x=%E3%81%82&y=日本", "/a%2Fb?x=%E3%81%82&y=%E6%97%A5%E6%9C%AC"],
                ["/😀", "/%F0%9F%98%80"],
                ["日本語", "%E6%97%A5%E6%9C%AC%E8%AA%9E"],
                // : を含んでいても、スキームの形でなければ相対パス
                ["日本語:x", "%E6%97%A5%E6%9C%AC%E8%AA%9E:x"],
                ["/a:b/日本", "/a:b/%E6%97%A5%E6%9C%AC"],
            ];
            for (const [location, expected] of cases) {
                expect((await redirect(location)).headers.get("location")).toBe(expected);
            }
        });

        test("絶対 URL は new URL() に任せる(日本語ドメインは punycode)", async () => {
            const cases: [string, string][] = [
                ["https://例え.jp/", "https://xn--r8jz45g.jp/"],
                ["https://例え.jp", "https://xn--r8jz45g.jp/"],
                ["https://例え.jp/パス?q=あ#é", "https://xn--r8jz45g.jp/%E3%83%91%E3%82%B9?q=%E3%81%82#%C3%A9"],
                ["https://example.com/日本語", "https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E"],
                ["HTTPS://例え.jp/", "https://xn--r8jz45g.jp/"],
                ["https://example.com/a%2Fb/日本", "https://example.com/a%2Fb/%E6%97%A5%E6%9C%AC"],
            ];
            for (const [location, expected] of cases) {
                expect((await redirect(location)).headers.get("location")).toBe(expected);
            }
        });

        test("不正なサロゲートは redirect_location(相対パス)", () => {
            for (const location of ["/\ud800", "/a\udc00b", "/日本\ud83d語"]) {
                const err = thrown(location);
                expect(err).toBeInstanceOf(TypeError);
                expect(err.code).toBe("redirect_location");
                expect(err.message).toBe(`Invalid redirect location: ${JSON.stringify(location)}`);
                expect(err.cause).toBeInstanceOf(URIError);
            }
        });

        test("絶対 URL のパスやクエリの不正なサロゲートは、new URL() が U+FFFD に置き換える(投げない)", async () => {
            const location = async (value: string) => (await redirect(value)).headers.get("location");

            expect(await location("https://example.com/\ud800")).toBe("https://example.com/%EF%BF%BD");
            expect(await location("https://example.com/a?q=\ud800")).toBe("https://example.com/a?q=%EF%BF%BD");
        });

        test("new URL() が投げる値は redirect_location(ホスト名の不正なサロゲートなど)", () => {
            for (const location of ["https://\ud800.jp/", "https://例 え.jp/", "https://[例え]/"]) {
                const err = thrown(location);
                expect(err).toBeInstanceOf(TypeError);
                expect(err.code).toBe("redirect_location");
                expect(err.cause).toBeInstanceOf(TypeError);
            }
        });
    });

    describe("不正な値", () => {
        test.each([200, 300, 304, 305, 306, 309, 404, 0, Number.NaN, "302"])("status %p は redirect_status", (status) => {
            const err = thrown("/x", status as never);

            expect(err).toBeInstanceOf(TypeError);
            expect(err.code).toBe("redirect_status");
            expect(err.message).toContain("301, 302, 303, 307 or 308");
        });

        // "/a\r\n" や "\r\n/a" は、Headers に任せると黙って "/a" になる
        test.each(["/a\r\nSet-Cookie: x=1", "/a\r\n", "\r\n/a", "/a\n", "\n/a", "/a\rb", "/a\nb", "\r", "/日本語\r\n", "https://例え.jp/\r\nx: y"])(
            "CR / LF を含む %j は redirect_location",
            (location) => {
                const err = thrown(location);

                expect(err).toBeInstanceOf(TypeError);
                expect(err.code).toBe("redirect_location");
                expect(err.message).toBe(`Invalid redirect location: ${JSON.stringify(location)}`);
                expect(err.cause).toBeUndefined();
            },
        );

        test("本番では固定の 500 になり、ヘッダーは足されない", async () => {
            const app = createApp();
            app.get("/crlf", (_, c) => c.redirect("/a\r\nSet-Cookie: x=1"));
            app.get("/status", (_, c) => c.redirect("/a", 200 as never));

            for (const path of ["/crlf", "/status"]) {
                const res = await app.fetch(req(path));
                expect(res.status).toBe(500);
                expect(await res.text()).toBe("500 Internal Server Error");
                expect(res.headers.get("location")).toBeNull();
                expect(res.headers.getSetCookie()).toEqual([]);
            }
        });

        test("開発モードでは日本語の説明が付く", async () => {
            const app = createApp({ dev: devtools() });
            app.get("/crlf", (_, c) => c.redirect("/a\r\n"));
            app.get("/surrogate", (_, c) => c.redirect("/\ud800"));
            app.get("/status", (_, c) => c.redirect("/a", 200 as never));

            expect(await (await app.fetch(req("/crlf"))).text()).toContain("リダイレクト先に使えない値です");
            expect(await (await app.fetch(req("/surrogate"))).text()).toContain("リダイレクト先に使えない値です");
            expect(await (await app.fetch(req("/status"))).text()).toContain("301 / 302 / 303 / 307 / 308");
        });
    });
});
