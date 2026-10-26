import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";

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
            seen = { one: c.cookie("name"), none: c.cookie("none"), all: c.cookie() };
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
            c.setCookie("name", "山田");
            c.setCookie("session", "abc", { maxAge: 60, secure: true, sameSite: "Strict", domain: "example.com" });
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
            c.setCookie("__Host-id", "1");
            return "ok";
        });

        const res = await app.fetch(req("/c"));

        expect(res.headers.getSetCookie()[0]).toContain("; Secure");
    });

    test("消す: Max-Age=0 と過去の Expires", async () => {
        const app = createApp();
        app.get("/c", (_, c) => {
            c.deleteCookie("name");
            return "ok";
        });

        const res = await app.fetch(req("/c"));

        expect(res.headers.getSetCookie()[0]).toBe("name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/");
    });

    test("名前に使えない文字があればエラー(ヘッダーを壊さないように)", () => {
        const app = createApp();
        let error: unknown;
        app.get("/c", (_, c) => {
            try {
                c.setCookie("bad name;", "x");
            } catch (e) {
                error = e;
            }
            return "ok";
        });

        return app.fetch(req("/c")).then(() => expect(error).toBeInstanceOf(TypeError));
    });
});
