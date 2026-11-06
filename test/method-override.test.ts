import { describe, expect, test } from "bun:test";
import { createApp, methodOverride, type MethodOverrideOptions } from "../src/index.ts";
import { serve } from "../adapters/serve/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { getIp } from "../src/ip.ts";
import { bundleOf } from "./bundle.ts";

const FORM = "application/x-www-form-urlencoded";

function makeApp() {
    const app = createApp();
    for (const name of ["get", "post", "put", "patch", "delete"] as const) {
        app[name]("/", async (_, c) => `${c.req.method} ${await c.req.text()}`);
    }
    return app;
}

const post = (body?: BodyInit, headers: Record<string, string> = {}) => new Request("http://localhost/", { method: "POST", body, headers });
const form = (body: string) => post(body, { "content-type": FORM });
const text = async (res: Response | Promise<Response>) => (await res).text();

describe("methodOverride()", () => {
    test("フォームの _method で上書きする。本文はハンドラーで読める", async () => {
        const wrapped = methodOverride(makeApp());
        for (const method of ["PUT", "PATCH", "DELETE", "delete", "Put"]) {
            const body = `a=1&_method=${method}&b=2`;
            expect(await text(wrapped.fetch(form(body)))).toBe(`${method.toUpperCase()} ${body}`);
        }
    });

    test("Content-Type に charset があっても読む", async () => {
        const res = methodOverride(makeApp()).fetch(post("_method=PUT", { "content-type": "Application/X-WWW-Form-Urlencoded; charset=utf-8" }));

        expect(await text(res)).toBe("PUT _method=PUT");
    });

    test("URL エンコードされた値も読む", async () => {
        const app = createApp();
        app.put("/", () => "put");
        const res = methodOverride(app, { form: "my method" }).fetch(form("my+method=PUT"));

        expect(await text(res)).toBe("put");
    });

    test("ヘッダーで上書きする。本文の種類を問わない(multipart でも使える)", async () => {
        const wrapped = methodOverride(makeApp());

        expect(await text(wrapped.fetch(post("x", { "x-http-method-override": "DELETE" })))).toBe("DELETE x");
        const multipart = new FormData();
        multipart.set("_method", "PUT");
        const res = await wrapped.fetch(new Request("http://localhost/", { method: "POST", body: multipart, headers: { "x-http-method-override": "PATCH" } }));
        expect((await res.text()).startsWith("PATCH ")).toBe(true);
    });

    test("ヘッダーがフォームより先", async () => {
        const res = methodOverride(makeApp()).fetch(post("_method=PUT", { "content-type": FORM, "x-http-method-override": "DELETE" }));

        expect((await text(res)).startsWith("DELETE ")).toBe(true);
    });

    test("ヘッダーの値が許可されていなければ、フォームを見る", async () => {
        const res = methodOverride(makeApp()).fetch(post("_method=PUT", { "content-type": FORM, "x-http-method-override": "BAD" }));

        expect((await text(res)).startsWith("PUT ")).toBe(true);
    });

    test("multipart は読まない", async () => {
        const multipart = new FormData();
        multipart.set("_method", "DELETE");
        const res = methodOverride(makeApp()).fetch(new Request("http://localhost/", { method: "POST", body: multipart }));

        expect((await text(res)).startsWith("POST ")).toBe(true);
    });

    test("POST 以外は上書きしない", async () => {
        const wrapped = methodOverride(makeApp());

        expect(await text(wrapped.fetch(new Request("http://localhost/?_method=DELETE", { headers: { "x-http-method-override": "DELETE" } })))).toBe("GET ");
        const put = new Request("http://localhost/", { method: "PUT", body: "_method=DELETE", headers: { "content-type": FORM, "x-http-method-override": "DELETE" } });
        expect((await text(wrapped.fetch(put))).startsWith("PUT ")).toBe(true);
    });

    test("クエリは見ない", async () => {
        const res = methodOverride(makeApp()).fetch(new Request("http://localhost/?_method=DELETE", { method: "POST" }));

        expect((await text(res)).startsWith("POST ")).toBe(true);
    });

    test("許可していないメソッドには上書きしない", async () => {
        const wrapped = methodOverride(makeApp());
        for (const method of ["GET", "HEAD", "TRACE", "CONNECT", "OPTIONS", "bad method", ""]) {
            const body = `_method=${encodeURIComponent(method)}`;
            expect(await text(wrapped.fetch(form(body)))).toBe(`POST ${body}`);
        }
    });

    test("allow で変えられる", async () => {
        const wrapped = methodOverride(makeApp(), { allow: ["delete"] });

        expect((await text(wrapped.fetch(form("_method=DELETE")))).startsWith("DELETE ")).toBe(true);
        expect((await text(wrapped.fetch(form("_method=PUT")))).startsWith("POST ")).toBe(true);
    });

    test("form: false なら本文を読まない", async () => {
        const res = methodOverride(makeApp(), { form: false }).fetch(form("_method=DELETE"));

        expect((await text(res)).startsWith("POST ")).toBe(true);
    });

    test("header: false ならヘッダーを見ない", async () => {
        const res = methodOverride(makeApp(), { header: false }).fetch(post("x", { "x-http-method-override": "DELETE" }));

        expect(await text(res)).toBe("POST x");
    });

    test("名前を変えられる", async () => {
        const wrapped = methodOverride(makeApp(), { form: "m", header: "X-Method" });

        expect((await text(wrapped.fetch(form("m=DELETE&_method=PUT")))).startsWith("DELETE ")).toBe(true);
        expect((await text(wrapped.fetch(post("x", { "x-method": "PUT" })))).startsWith("PUT ")).toBe(true);
    });

    test("64 KiB を超えるフォームは読まない。本文はそのまま読める", async () => {
        const big = `_method=DELETE&x=${"a".repeat(64 * 1024)}`;

        expect(await text(methodOverride(makeApp()).fetch(form(big)))).toBe(`POST ${big}`);
    });

    test("ちょうど 64 KiB なら読む", async () => {
        const prefix = "_method=DELETE&x=";
        const body = prefix + "a".repeat(64 * 1024 - prefix.length);

        expect(await text(methodOverride(makeApp()).fetch(form(body)))).toBe(`DELETE ${body}`);
    });

    test("ストリームの本文でも、読みながら確かめる", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("_method="));
                controller.enqueue(new TextEncoder().encode("PUT"));
                controller.close();
            },
        });
        const req = new Request("http://localhost/", { method: "POST", body: stream, headers: { "content-type": FORM } });

        expect(await text(methodOverride(makeApp()).fetch(req))).toBe("PUT _method=PUT");
    });

    test("本文がないフォームでも壊れない", async () => {
        expect(await text(methodOverride(makeApp()).fetch(post(undefined, { "content-type": FORM })))).toBe("POST ");
    });

    test("ミドルウェアは上書きしたあとのメソッドを見る。405 もそのメソッドで決まる", async () => {
        const app = createApp();
        const seen: string[] = [];
        app.use(async (c, next) => {
            seen.push(`${c.req.method} ${c.route}`);
            await next();
        });
        app.delete("/x", () => "deleted");
        const wrapped = methodOverride(app);
        const to = (body: string) => new Request("http://localhost/x", { method: "POST", body, headers: { "content-type": FORM } });

        expect(await text(wrapped.fetch(to("_method=DELETE")))).toBe("deleted");
        expect(seen).toEqual(["DELETE /x"]);
        expect((await wrapped.fetch(to("_method=PUT"))).status).toBe(405);
    });

    test("c.req は本物の Request", async () => {
        let proto: unknown;
        const app = createApp();
        app.put("/", (_, c) => {
            proto = Object.getPrototypeOf(c.req);
            return "x";
        });
        await methodOverride(app).fetch(form("_method=PUT"));

        expect(proto).toBe(Request.prototype);
    });

    test("接続元を渡す。Bun の server は、元の Request で読む", async () => {
        const app = createApp();
        app.put("/", (_, c) => getIp(c) ?? "null");
        app.post("/", (_, c) => getIp(c) ?? "null");
        const wrapped = methodOverride(app);
        const original = form("_method=PUT");
        const server = { requestIP: (req: Request) => (req === original ? { address: "203.0.113.5" } : null) };

        expect(await text(wrapped.fetch(original, server))).toBe("203.0.113.5");
        expect(await text(wrapped.fetch(form("_method=PUT"), { remoteAddr: { hostname: "203.0.113.6" } }))).toBe("203.0.113.6");
        expect(await text(wrapped.fetch(post("x"), { remoteAddr: { hostname: "203.0.113.7" } }))).toBe("203.0.113.7");
    });

    test("3つ目の引数(Workers の ctx)も渡す", async () => {
        let waited = false;
        const app = createApp();
        app.put("/", (_, c) => {
            c.executionCtx.waitUntil(Promise.resolve());
            return "x";
        });
        const ctx = { waitUntil: () => void (waited = true), passThroughOnException: () => {} };
        await methodOverride(app).fetch(form("_method=PUT"), {}, ctx);

        expect(waited).toBe(true);
    });

    test("serve() の入口でも使える(routeList を持つ)", () => {
        const wrapped = methodOverride(makeApp());
        const accepts: Parameters<typeof serve>[0] = wrapped;

        expect(accepts.routeList().map((r) => r.method).sort()).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
    });

    test.each([
        [{ form: false, header: false }],
        [{ form: "" }],
        [{ form: 1 }],
        [{ header: "x bad" }],
        [{ header: "" }],
        [{ allow: [] }],
        [{ allow: "PUT" }],
        [{ allow: ["GET"] }],
        [{ allow: ["head"] }],
        [{ allow: ["TRACE"] }],
        [{ allow: ["CONNECT"] }],
        [{ allow: ["BAD METHOD"] }],
    ])("設定が不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            methodOverride(makeApp(), options as MethodOverrideOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err)).toContain("methodOverride()");
    });

    test("使わなければ、本体に入らない", async () => {
        expect((await bundleOf("createApp")).toLowerCase()).not.toContain("method-override");
    });
});
