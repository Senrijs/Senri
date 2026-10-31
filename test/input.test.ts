import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { deleteCookie, getCookie, setCookie } from "../src/cookie.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("c.query", () => {
    test("1つ取る・全部取る・同じ名前を配列で取る", async () => {
        const app = createApp();
        let seen: unknown;
        app.get("/s", (_, c) => {
            seen = { page: c.query("page"), none: c.query("none"), all: c.query(), tags: c.queries("tag") };
            return "ok";
        });

        await app.fetch(req("/s?page=2&tag=a&tag=b&q=%E5%B1%B1"));

        expect(seen).toEqual({
            page: "2",
            none: undefined,
            // 同じ名前が複数あるときは最後の値
            all: { page: "2", tag: "b", q: "山" },
            tags: ["a", "b"],
        });
    });
});

describe("c.body", () => {
    const post = (body: BodyInit, type?: string) =>
        req("/b", { method: "POST", body, headers: type ? { "content-type": type } : {} });

    test("JSON(application/json と +json)", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => ({ got: await c.body() }));

        expect(await (await app.fetch(post('{"a":1}', "application/json"))).json()).toEqual({ got: { a: 1 } });
        expect(await (await app.fetch(post('{"a":2}', "application/vnd.api+json"))).json()).toEqual({ got: { a: 2 } });
    });

    test("フォーム(urlencoded と multipart)。同じ名前は配列になる", async () => {
        const app = createApp();
        let got: unknown;
        app.post("/b", async (_, c) => {
            got = await c.body();
            return "ok";
        });

        await app.fetch(post("name=%E5%B1%B1%E7%94%B0&tag=a&tag=b", "application/x-www-form-urlencoded"));
        expect(got).toEqual({ name: "山田", tag: ["a", "b"] });

        const form = new FormData();
        form.append("name", "yahari");
        form.append("file", new File(["hi"], "hi.txt", { type: "text/plain" }));
        await app.fetch(req("/b", { method: "POST", body: form }));
        const multipart = got as { name: string; file: File };
        expect(multipart.name).toBe("yahari");
        expect(await multipart.file.text()).toBe("hi");
    });

    test("テキストと、それ以外(ArrayBuffer)", async () => {
        const app = createApp();
        let got: unknown;
        app.post("/b", async (_, c) => {
            got = await c.body();
            return "ok";
        });

        await app.fetch(post("こんにちは", "text/plain; charset=utf-8"));
        expect(got).toBe("こんにちは");

        await app.fetch(post(new Uint8Array([1, 2, 3]), "application/octet-stream"));
        expect(new Uint8Array(got as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("一度読んだら覚えておく(ミドルウェアとハンドラーの両方で読める)", async () => {
        const app = createApp();
        app.use(async (c, next) => {
            await c.body();
            return next();
        });
        app.post("/b", async (_, c) => ({ again: await c.body() }));

        const res = await app.fetch(post('{"a":1}', "application/json"));

        expect(await res.json()).toEqual({ again: { a: 1 } });
    });

    test("壊れた JSON は 400", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => ({ got: await c.body() }));

        const res = await app.fetch(post("{bad", "application/json"));

        expect(res.status).toBe(400);
    });
});

describe("Cookie", () => {
    test("読む(1つ・全部)。値はデコードする", async () => {
        const app = createApp();
        let seen: unknown;
        app.get("/c", (_, c) => {
            seen = { one: getCookie(c, "name"), none: getCookie(c, "none"), all: getCookie(c) };
            return "ok";
        });

        await app.fetch(req("/c", { headers: { cookie: "name=%E5%B1%B1%E7%94%B0; theme=dark; broken=%E0%A4%A" } }));

        expect(seen).toEqual({
            one: "山田",
            none: undefined,
            // デコードできない値は、そのまま
            all: { name: "山田", theme: "dark", broken: "%E0%A4%A" },
        });
    });

    test("付ける: 既定は Path=/・HttpOnly・SameSite=Lax。値はエンコードする", async () => {
        const app = createApp();
        app.get("/c", (_, c) => {
            setCookie(c, "name", "山田");
            setCookie(c, "session", "abc", { maxAge: 60, secure: true, sameSite: "Strict", domain: "example.com" });
            return "ok";
        });

        const res = await app.fetch(req("/c"));

        expect(res.headers.getSetCookie()).toEqual([
            "name=%E5%B1%B1%E7%94%B0; Path=/; HttpOnly; SameSite=Lax",
            "session=abc; Max-Age=60; Domain=example.com; Path=/; HttpOnly; Secure; SameSite=Strict",
        ]);
    });

    test("__Host- / __Secure- で始まる名前には Secure を必ず付ける", async () => {
        const app = createApp();
        app.get("/c", (_, c) => {
            setCookie(c, "__Host-id", "1");
            return "ok";
        });

        const res = await app.fetch(req("/c"));

        expect(res.headers.getSetCookie()[0]).toContain("; Secure");
    });

    test("消す: Max-Age=0 と過去の Expires", async () => {
        const app = createApp();
        app.get("/c", (_, c) => {
            deleteCookie(c, "name");
            return "ok";
        });

        const res = await app.fetch(req("/c"));

        expect(res.headers.getSetCookie()[0]).toBe("name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/");
    });

    // Secure のない __Host- / __Secure- の Set-Cookie はブラウザに捨てられ、消せない(付けるときと同じにする)
    test("消す: __Host- / __Secure- で始まる名前には Secure を付ける", async () => {
        const app = createApp();
        app.get("/c", (_, c) => {
            deleteCookie(c, "__Host-id");
            deleteCookie(c, "__Secure-id");
            deleteCookie(c, "plain");
            return "ok";
        });

        const res = await app.fetch(req("/c"));

        expect(res.headers.getSetCookie()).toEqual([
            "__Host-id=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure",
            "__Secure-id=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure",
            "plain=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
        ]);
    });

    test("名前に使えない文字があればエラー(ヘッダーを壊さないように)", () => {
        const app = createApp();
        let error: unknown;
        app.get("/c", (_, c) => {
            try {
                setCookie(c, "bad name;", "x");
            } catch (e) {
                error = e;
            }
            return "ok";
        });

        return app.fetch(req("/c")).then(() => expect(error).toBeInstanceOf(TypeError));
    });

    // __Host- の Cookie に Domain を付けると、ブラウザに捨てられる(黙って効かないより、エラーにする)
    test("__Host- の Cookie に domain を渡したらエラー(付けるときも消すときも)", async () => {
        const app = createApp();
        const errors: unknown[] = [];
        app.get("/c", (_, c) => {
            for (const call of [
                () => setCookie(c, "__Host-id", "1", { domain: "example.com" }),
                () => deleteCookie(c, "__Host-id", { domain: "example.com" }),
            ]) {
                try {
                    call();
                } catch (e) {
                    errors.push(e);
                }
            }
            return "ok";
        });
        // domain がなければ、今までどおり付けられる。__Secure- や普通の名前は domain を付けてよい
        app.get("/ok", (_, c) => {
            setCookie(c, "__Host-id", "1");
            deleteCookie(c, "__Host-id");
            setCookie(c, "__Secure-id", "1", { domain: "example.com" });
            setCookie(c, "plain", "1", { domain: "example.com" });
            return "ok";
        });

        const res = await app.fetch(req("/c"));
        expect(errors).toHaveLength(2);
        for (const error of errors) {
            expect(error).toBeInstanceOf(TypeError);
            expect((error as { code?: string }).code).toBe("cookie_host_domain");
        }
        // 投げたので、Set-Cookie は1つも付いていない
        expect(res.headers.getSetCookie()).toEqual([]);

        const ok = await app.fetch(req("/ok"));
        expect(ok.headers.getSetCookie()).toHaveLength(4);
    });
});

// ブラウザは __Host- / __Secure- を大文字小文字を区別せずに判定する(RFC 6265bis。Chromium と Firefox 127 以降)
// "__HOST-id" も __Host- として扱わないと、Secure が付かずに捨てられ、domain の確認もすり抜ける
describe("Cookie の接頭辞は大文字小文字を区別しない", () => {
    const NAMES = ["__HOST-id", "__host-id", "__SECURE-id", "__secure-id"];

    test("付けるときも消すときも Secure を付ける", async () => {
        const app = createApp();
        app.get("/c", (_, c) => {
            for (const name of NAMES) {
                setCookie(c, name, "1");
                deleteCookie(c, name);
            }
            return "ok";
        });

        const cookies = (await app.fetch(req("/c"))).headers.getSetCookie();
        expect(cookies).toHaveLength(NAMES.length * 2);
        for (const cookie of cookies) expect(cookie).toContain("; Secure");
    });

    test("__HOST- / __host- にも domain を付けられない", () => {
        const app = createApp();
        const errors: unknown[] = [];
        app.get("/c", (_, c) => {
            for (const name of ["__HOST-id", "__host-id"]) {
                try {
                    setCookie(c, name, "1", { domain: "example.com" });
                } catch (e) {
                    errors.push(e);
                }
            }
            return "ok";
        });

        return app.fetch(req("/c")).then(() => {
            expect(errors.map((e) => (e as { code?: string }).code)).toEqual(["cookie_host_domain", "cookie_host_domain"]);
        });
    });
});

describe("送る側が決める名前(__proto__ / constructor)", () => {
    test("フォームのフィールド名が、継承したものと混ざらない", async () => {
        const app = createApp();
        app.post("/", async (_, c) => {
            const body = (await c.body()) as Record<string, unknown>;
            return { keys: Object.keys(body), proto: body["__proto__"], ctor: body["constructor"], length: body["length"] ?? null };
        });
        const res = await app.fetch(
            new Request("http://localhost/", {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: "__proto__=a&__proto__=b&constructor=c",
            }),
        );
        expect(await res.json()).toEqual({ keys: ["__proto__", "constructor"], proto: ["a", "b"], ctor: "c", length: null });
    });

    test("constructor という名前の Cookie も読める。ない名前は undefined", async () => {
        const app = createApp();
        app.get("/", (_, c) => ({ ctor: getCookie(c, "constructor") ?? null, missing: getCookie(c, "toString") ?? null }));
        const res = await app.fetch(new Request("http://localhost/", { headers: { cookie: "constructor=1" } }));
        expect(await res.json()).toEqual({ ctor: "1", missing: null });
    });
});
