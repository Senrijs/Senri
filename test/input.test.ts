import { describe, expect, test } from "bun:test";
import { createApp, defineRoutes, endpoint } from "../src/index.ts";
import { explainText } from "../src/dev/explain.ts";
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

    test("壊れた JSON は 400。本文は英語", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => ({ got: await c.body() }));

        const res = await app.fetch(post("{bad", "application/json"));

        expect(res.status).toBe(400);
        expect(await res.text()).toBe("400 Bad Request: Invalid JSON");
    });

    test("読めないフォームは 400。本文は英語", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => ({ got: await c.body() }));

        // boundary のない multipart は読めない
        const res = await app.fetch(post("x", "multipart/form-data"));

        expect(res.status).toBe(400);
        expect(await res.text()).toBe("400 Bad Request: Invalid form data");
    });
});

describe("c.bodyJson / c.bodyBytes", () => {
    const post = (body: BodyInit, type?: string) =>
        req("/b", { method: "POST", body, headers: type ? { "content-type": type } : {} });
    // 受け取った値を検査せずにそのまま通すスキーマ
    const anything = { "~standard": { version: 1 as const, vendor: "t", validate: (value: unknown) => ({ value }) } };

    test("c.bodyJson() は Content-Type を見ずに JSON として読む", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => ({ got: await c.bodyJson<{ a: number }>() }));

        for (const type of ["application/json", "text/plain", "application/octet-stream", undefined]) {
            expect(await (await app.fetch(post('{"a":1}', type))).json()).toEqual({ got: { a: 1 } });
        }
    });

    test("c.bodyJson(): 壊れた JSON と空の本文は 400(c.req.json() は 500)", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => ({ got: await c.bodyJson() }));
        app.post("/req", async (_, c) => ({ got: await c.req.json() }));

        for (const body of ["{bad", "", "<a>"]) {
            const res = await app.fetch(post(body, "application/json"));
            expect(res.status).toBe(400);
            expect(await res.text()).toBe("400 Bad Request: Invalid JSON");
        }
        // 比べるため: Request のメソッドそのままだと、ふつうのエラー(500)
        expect((await app.fetch(req("/req", { method: "POST", body: "{bad" }))).status).toBe(500);
    });

    test("c.bodyBytes() は Content-Type を見ずに ArrayBuffer で読む", async () => {
        const app = createApp();
        let got: unknown;
        app.post("/b", async (_, c) => {
            got = await c.bodyBytes();
            return "ok";
        });

        for (const type of ["application/json", "text/plain", "application/x-www-form-urlencoded", undefined]) {
            await app.fetch(post("a=1", type));
            expect(got).toBeInstanceOf(ArrayBuffer);
            expect(new TextDecoder().decode(got as ArrayBuffer)).toBe("a=1");
        }
        await app.fetch(post(new Uint8Array([0, 255, 1])));
        expect(new Uint8Array(got as ArrayBuffer)).toEqual(new Uint8Array([0, 255, 1]));
    });

    test("一度読んだら覚えておく(何度呼んでも同じ値。c.req.json() は2回目でエラー)", async () => {
        const app = createApp();
        app.use("/b", async (c, next) => {
            await c.bodyJson();
            return next();
        });
        app.post("/b", async (_, c) => ({ same: (await c.bodyJson()) === (await c.bodyJson()), again: await c.bodyJson() }));
        app.post("/bytes", async (_, c) => ({ same: (await c.bodyBytes()) === (await c.bodyBytes()) }));
        app.post("/req", async (_, c) => {
            await c.req.json();
            return c.req.json();
        });

        expect(await (await app.fetch(post('{"a":1}'))).json()).toEqual({ same: true, again: { a: 1 } });
        expect(await (await app.fetch(req("/bytes", { method: "POST", body: "x" }))).json()).toEqual({ same: true });
        expect((await app.fetch(req("/req", { method: "POST", body: "{}" }))).status).toBe(500);
    });

    test("c.body() と c.bodyJson() は、どちらを先に呼んでも両方読める", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => {
            const first = c.req.headers.get("x-first");
            const a = first === "body" ? await c.body() : await c.bodyJson();
            const b = first === "body" ? await c.bodyJson() : await c.body();
            return { a, b };
        });

        for (const first of ["body", "json"]) {
            const res = await app.fetch(req("/b", { method: "POST", body: '{"a":1}', headers: { "content-type": "application/json", "x-first": first } }));
            expect(await res.json()).toEqual({ a: { a: 1 }, b: { a: 1 } });
        }
    });

    test("c.bodyBytes() を先に呼べば、c.body()・c.bodyJson()・ルートの body のスキーマは、そのバイト列から読む", async () => {
        const app = createApp();
        // 署名を確かめるミドルウェアのように、元のバイト列を先に読む
        app.use(async (c, next) => {
            c.set("size", (await c.bodyBytes()).byteLength);
            return next();
        });
        app.post("/b", async (_, c) => ({ size: c.get("size"), body: await c.body(), json: await c.bodyJson() }));
        app.post("/text", async (_, c) => ({ body: await c.body() }));
        app.post("/form", async (_, c) => ({ body: await c.body() }));
        app.routes(defineRoutes({ "POST /schema": endpoint({ body: anything }, (_, c) => ({ size: c.get("size"), valid: c.valid("body") })) }));

        expect(await (await app.fetch(post('{"a":1}', "application/json"))).json()).toEqual({ size: 7, body: { a: 1 }, json: { a: 1 } });
        expect(await (await app.fetch(req("/text", { method: "POST", body: "こんにちは", headers: { "content-type": "text/plain" } }))).json()).toEqual({ body: "こんにちは" });
        const form = new FormData();
        form.append("name", "yahari");
        form.append("tag", "a");
        form.append("tag", "b");
        expect(await (await app.fetch(req("/form", { method: "POST", body: form }))).json()).toEqual({ body: { name: "yahari", tag: ["a", "b"] } });
        const schema = await app.fetch(req("/schema", { method: "POST", body: '{"b":2}', headers: { "content-type": "application/json" } }));
        expect(await schema.json()).toEqual({ size: 7, valid: { b: 2 } });
    });

    test("文字列やフォームとして読んだあとの c.bodyBytes() は、code の付いたエラー(元のバイト列が残っていないため)", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => {
            const how = c.req.headers.get("x-read");
            if (how === "body") await c.body();
            else if (how === "json") await c.bodyJson();
            else await c.req.text();
            return { code: await c.bodyBytes().then(() => null, (err: { code?: string }) => err.code) };
        });

        for (const how of ["body", "json", "req"]) {
            const res = await app.fetch(req("/b", { method: "POST", body: '{"a":1}', headers: { "content-type": "application/json", "x-read": how } }));
            expect(await res.json()).toEqual({ code: "body_bytes_after_read" });
        }
        expect(explainText({ code: "body_bytes_after_read" }, "ja")).toContain("先に c.bodyBytes()");
        expect(explainText({ code: "body_bytes_after_read" }, "en")).toContain("Call c.bodyBytes() first");
    });

    test("c.body() が ArrayBuffer で読んだあとなら、c.bodyBytes() は同じ ArrayBuffer", async () => {
        const app = createApp();
        app.post("/b", async (_, c) => ({ same: (await c.body()) === (await c.bodyBytes()) }));

        expect(await (await app.fetch(post(new Uint8Array([1, 2]), "application/octet-stream"))).json()).toEqual({ same: true });
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

    // __Host- の Cookie は Path=/ でないと、ブラウザに捨てられる(domain と同じく、エラーにする)
    test("__Host- の Cookie に \"/\" 以外の path を渡したらエラー(付けるときも消すときも)", async () => {
        const app = createApp();
        const errors: unknown[] = [];
        app.get("/c", (_, c) => {
            for (const call of [
                () => setCookie(c, "__Host-id", "1", { path: "/admin" }),
                () => deleteCookie(c, "__Host-id", { path: "/admin" }),
                // 空の Path はブラウザが既定のパス(リクエストのディレクトリ)にするので、"/" にはならない
                () => setCookie(c, "__Host-id", "1", { path: "" }),
                () => deleteCookie(c, "__Host-id", { path: "" }),
            ]) {
                try {
                    call();
                } catch (e) {
                    errors.push(e);
                }
            }
            return "ok";
        });
        // path を省略(Path=/ になる)か "/" なら、今までどおり付けられる。__Secure- や普通の名前は path を付けてよい
        app.get("/ok", (_, c) => {
            setCookie(c, "__Host-id", "1");
            setCookie(c, "__Host-id2", "1", { path: "/" });
            deleteCookie(c, "__Host-id", { path: "/" });
            setCookie(c, "__Secure-id", "1", { path: "/admin" });
            setCookie(c, "plain", "1", { path: "/admin" });
            return "ok";
        });

        const res = await app.fetch(req("/c"));
        expect(errors).toHaveLength(4);
        for (const error of errors) {
            expect(error).toBeInstanceOf(TypeError);
            expect((error as { code?: string }).code).toBe("cookie_host_path");
        }
        expect(res.headers.getSetCookie()).toEqual([]);

        const ok = await app.fetch(req("/ok"));
        expect(ok.headers.getSetCookie()).toHaveLength(5);
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

    test("__HOST- / __host- も path が \"/\" 以外ならエラー(付けるときも消すときも)", () => {
        const app = createApp();
        const errors: unknown[] = [];
        app.get("/c", (_, c) => {
            for (const call of [
                () => setCookie(c, "__HOST-x", "1", { path: "/admin" }),
                () => deleteCookie(c, "__HOST-x", { path: "/admin" }),
                () => setCookie(c, "__host-x", "1", { path: "/admin" }),
            ]) {
                try {
                    call();
                } catch (e) {
                    errors.push(e);
                }
            }
            return "ok";
        });

        return app.fetch(req("/c")).then((res) => {
            expect(errors.map((e) => (e as { code?: string }).code)).toEqual([
                "cookie_host_path",
                "cookie_host_path",
                "cookie_host_path",
            ]);
            expect(res.headers.getSetCookie()).toEqual([]);
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
