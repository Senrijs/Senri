// ドキュメントの「リクエストとレスポンス」の章に書いた動き
import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyLimit, createApp, HttpError } from "../../src/index.ts";
import { getSignedCookie, setCookie, setSignedCookie } from "../../src/cookie.ts";
import { getIp, trustProxy } from "../../src/ip.ts";
import { streamSSE, streamText } from "../../src/streaming.ts";
import { multipart } from "../../src/multipart.ts";
import { serveStatic } from "../../adapters/static/index.ts";
import { claim, ipInfo, quiet, req } from "./claim.ts";

// ---------- request-response/context ----------
{
    const app = createApp<{ user: string }>();
    app.use(async (c, next) => {
        c.set("user", "alice");
        c.header("x-mw", "1");
        c.header("content-type", "text/x-from-header");
        await next();
    });
    app.get("/res", () => new Response("r", { headers: { "content-type": "text/own" } }));
    app.get("/err", () => {
        throw new HttpError(418, "teapot");
    });
    app.get("/route/:id", (_, c) => `${c.route}|${c.params.id}|${c.get("user")}`);
    claim("request-response/context#read", "c.route・c.params・c.get()", async () => {
        expect(await (await req(app, "GET", "/route/7")).text()).toBe("/route/:id|7|alice");
    });
    claim("request-response/context#route-before-next", "c.route と c.params は next() の前から読める", async () => {
        const a = createApp();
        let seen = "";
        a.use(async (c, next) => {
            seen = `${c.route} ${c.params.id}`;
            await next();
        });
        a.get("/users/:id", () => "x");
        await req(a, "GET", "/users/3");
        expect(seen).toBe("/users/:id 3");
    });
    claim("request-response/context#header-always", "c.header() は Response を直接返したときも、エラーのときも付く", async () => {
        expect((await req(app, "GET", "/res")).headers.get("x-mw")).toBe("1");
        expect((await req(app, "GET", "/err")).headers.get("x-mw")).toBe("1");
    });
    claim("request-response/context#content-type-wins", "Content-Type はレスポンスにあればそちらが優先", async () => {
        expect((await req(app, "GET", "/res")).headers.get("content-type")).toBe("text/own");
    });
}

// ---------- request-response/request ----------
{
    const secret = "s".repeat(32);
    const app = createApp();
    app.get("/q", (_, c) => ({ page: c.query("page") ?? null, tags: c.queries("tag"), ip: getIp(c) }));
    app.post("/set", async (_, c) => {
        await setSignedCookie(c, "user", "42", secret);
        setCookie(c, "seen", "1");
        return "ok";
    });
    app.get("/me", async (_, c) => ({ v: (await getSignedCookie(c, "user", secret)) ?? null }));
    claim("request-response/request#query", 'c.query("page") は "2"、c.queries("tag") は ["a", "b"]', async () => {
        const j = await (await req(app, "GET", "/q?page=2&tag=a&tag=b")).json();
        expect(j.page).toBe("2");
        expect(j.tags).toEqual(["a", "b"]);
    });
    claim("request-response/request#ip-null", "getIp(c) は、分からなければ null", async () => {
        expect((await (await app.fetch(new Request("http://localhost/q"))).json()).ip).toBeNull();
    });
    claim("request-response/request#cookie-defaults", "setCookie() の既定は Path=/・HttpOnly・SameSite=Lax", async () => {
        const seen = (await req(app, "POST", "/set")).headers.getSetCookie().find((c) => c.startsWith("seen=1"))!;
        expect(seen).toContain("Path=/");
        expect(seen).toContain("HttpOnly");
        expect(seen).toContain("SameSite=Lax");
    });
    claim("request-response/request#signed-cookie", "署名付き Cookie: 読める・書き換えられていたら false・なければ undefined", async () => {
        const signed = (await req(app, "POST", "/set")).headers.getSetCookie().find((c) => c.startsWith("user="))!.split(";")[0]!;
        expect((await (await req(app, "GET", "/me", { headers: { cookie: signed } })).json()).v).toBe("42");
        expect((await (await req(app, "GET", "/me", { headers: { cookie: signed.replace("42", "43") } })).json()).v).toBe(false);
        expect((await (await req(app, "GET", "/me")).json()).v).toBeNull();
    });
    claim("request-response/request#signed-cookie-name", "値を別の名前の Cookie に写しても通らない", async () => {
        const signed = (await req(app, "POST", "/set")).headers.getSetCookie().find((c) => c.startsWith("user="))!.split(";")[0]!;
        const a = createApp();
        a.get("/", async (_, c) => ({ v: (await getSignedCookie(c, "other", secret)) ?? null }));
        expect((await (await req(a, "GET", "/", { headers: { cookie: signed.replace("user=", "other=") } })).json()).v).toBe(false);
    });
    claim("request-response/request#trust-proxy", "trustProxy() は X-Forwarded-For を右から数える", async () => {
        const a = createApp();
        const clientIp = trustProxy({ hops: 1 });
        a.get("/ip", (_, c) => clientIp(c) ?? "unknown");
        const r = await req(a, "GET", "/ip", { info: ipInfo("10.0.0.1"), headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.7" } });
        expect(await r.text()).toBe("203.0.113.7");
    });
}

// ---------- request-response/body ----------
{
    const app = createApp();
    app.post("/b", async (_, c) => {
        const v = await c.body();
        const again = await c.body();
        return { type: v instanceof ArrayBuffer ? "ArrayBuffer" : typeof v, same: v === again, v: v instanceof ArrayBuffer ? null : v };
    });
    const post = (body: BodyInit, type: string) => req(app, "POST", "/b", { body, headers: { "content-type": type } });
    claim("request-response/body#c-body", "c.body(): JSON は値、フォームはオブジェクト、テキストは文字列、それ以外は ArrayBuffer", async () => {
        expect((await (await post('{"a":1}', "application/json")).json()).v).toEqual({ a: 1 });
        expect((await (await post("a=1", "application/x-www-form-urlencoded")).json()).v).toEqual({ a: "1" });
        expect((await (await post("hi", "text/plain")).json()).v).toBe("hi");
        expect((await (await post(new Uint8Array([1]), "application/octet-stream")).json()).type).toBe("ArrayBuffer");
    });
    claim("request-response/body#c-body-same", "c.body() は何度呼んでも同じ結果", async () => {
        expect((await (await post('{"a":1}', "application/json")).json()).same).toBe(true);
    });
    claim("request-response/body#default-1mib", "既定の上限 1 MiB を超えたら 413", async () => {
        expect((await post("x".repeat(1024 * 1024), "text/plain")).status).toBe(200);
        expect((await post("x".repeat(1024 * 1024 + 1), "text/plain")).status).toBe(413);
    });
    claim("request-response/body#body-limit-replaces", "bodyLimit() は既定を置き換える", async () => {
        const a = createApp();
        a.use("/import", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
        a.post("/import", async (_, c) => String((await c.req.text()).length));
        expect((await req(a, "POST", "/import", { body: "x".repeat(1024 * 1024 + 1) })).status).toBe(200);
    });
    claim("request-response/body#max-body-size", "createApp({ maxBodySize }) でアプリ全体の上限を変える", async () => {
        const a = createApp({ maxBodySize: 10 });
        a.post("/t", async (_, c) => String((await c.req.text()).length));
        expect((await req(a, "POST", "/t", { body: "x".repeat(11) })).status).toBe(413);
    });
}

// ---------- request-response/response-helpers ----------
{
    const app = createApp();
    app.post("/users", (_, c) => c.json({ id: 1 }, 201));
    app.get("/plain", (_, c) => c.text("not ready", 503));
    app.get("/html", (_, c) => c.html("<h1>x</h1>"));
    app.get("/r", (_, c) => c.redirect("/new"));
    app.get("/r301", (_, c) => c.redirect("/new", 301));
    app.get("/crlf", (_, c) => c.redirect("/a\r\nx: y"));
    app.get("/loc", (_, c) => {
        c.header("location", "/x");
        return c.redirect("/y");
    });
    app.post("/login", (_, c) => {
        setCookie(c, "session", "abc");
        return c.redirect("/dashboard", 303);
    });
    claim("request-response/response-helpers#helpers", "c.json(201)・c.text(503)・c.html()", async () => {
        expect((await req(app, "POST", "/users")).status).toBe(201);
        const t = await req(app, "GET", "/plain");
        expect([t.status, await t.text()]).toEqual([503, "not ready"]);
        expect((await req(app, "GET", "/html")).headers.get("content-type")).toBe("text/html; charset=utf-8");
    });
    claim("request-response/response-helpers#redirect", "c.redirect() の既定は 302、301 も書ける", async () => {
        const r = await req(app, "GET", "/r");
        expect([r.status, r.headers.get("location")]).toEqual([302, "/new"]);
        expect((await req(app, "GET", "/r301")).status).toBe(301);
    });
    claim("request-response/response-helpers#redirect-wins", "c.redirect() の値が c.header(location) より優先", async () => {
        expect((await req(app, "GET", "/loc")).headers.get("location")).toBe("/y");
    });
    claim("request-response/response-helpers#crlf", "CR・LF を含む値はエラー", async () => {
        expect((await quiet(() => req(app, "GET", "/crlf"))).status).toBe(500);
    });
    claim("request-response/response-helpers#cookie-redirect", "setCookie() はリダイレクトにも付く", async () => {
        const r = await req(app, "POST", "/login");
        expect(r.status).toBe(303);
        expect(r.headers.getSetCookie().some((c) => c.startsWith("session=abc"))).toBe(true);
    });
}

// ---------- request-response/streaming ----------
claim("request-response/streaming#sse", "SSE は最初に : connected を送り、writeSSE の形で送る", async () => {
    const app = createApp();
    app.get("/sse", (_, c) => streamSSE(c, async (s) => void (await s.writeSSE({ event: "tick", id: "0", data: "0" })), { heartbeat: false }));
    const t = await (await req(app, "GET", "/sse")).text();
    expect(t.startsWith(": connected")).toBe(true);
    expect(t).toContain("event: tick\nid: 0\ndata: 0\n\n");
});
claim("request-response/streaming#on-error", "onError で最後に書き込んで、正常に閉じる", async () => {
    const app = createApp();
    app.get("/log", (_, c) =>
        streamText(
            c,
            async () => {
                throw new Error("x");
            },
            { onError: async (_err, s) => void (await s.write("\n(途中で失敗しました)\n")) },
        ),
    );
    expect(await (await req(app, "GET", "/log")).text()).toContain("(途中で失敗しました)");
});
claim("request-response/streaming#heartbeat", "heartbeat で : ping を送る(既定は 5 秒。{ heartbeat } で変えられる)", async () => {
    const app = createApp();
    app.get("/sse", (_, c) => streamSSE(c, async (s) => void (await s.sleep(250)), { heartbeat: 100 }));
    expect(await (await req(app, "GET", "/sse")).text()).toContain(": ping");
    const src = await Bun.file(join(import.meta.dir, "../../src/streaming.ts")).text();
    expect(src).toContain("const DEFAULT_HEARTBEAT = 5000;");
});

// ---------- request-response/multipart ----------
{
    const app = createApp();
    app.post("/mp", async (_, c) => {
        const out: unknown[] = [];
        for await (const part of multipart(c, { maxFileSize: 10 })) out.push({ name: part.name, filename: part.filename ?? null, type: part.contentType, text: await part.text() });
        return out;
    });
    claim("request-response/multipart#parts", "フィールドは filename が undefined・contentType は text/plain、選ばなかった欄は \"\"", async () => {
        const form = new FormData();
        form.append("a", "1");
        form.append("f", new File(["hi"], "x.txt", { type: "text/plain" }));
        form.append("empty", new File([], ""));
        const j = await (await req(app, "POST", "/mp", { body: form })).json();
        expect(j[0]).toMatchObject({ name: "a", filename: null, type: "text/plain", text: "1" });
        expect(j[1]).toMatchObject({ filename: "x.txt", text: "hi" });
        expect(j[2].filename).toBe("");
    });
    claim("request-response/multipart#errors", "上限を超えたら 413、boundary がなければ 400、multipart でなければ 415", async () => {
        const big = new FormData();
        big.append("f", new File(["x".repeat(20)], "a.bin"));
        expect((await req(app, "POST", "/mp", { body: big })).status).toBe(413);
        expect((await req(app, "POST", "/mp", { body: "x", headers: { "content-type": "multipart/form-data" } })).status).toBe(400);
        expect((await req(app, "POST", "/mp", { body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    });
}

// ---------- request-response/static ----------
{
    const root = mkdtempSync(join(tmpdir(), "senri-static-"));
    writeFileSync(join(root, "app.js"), "console.log(1)");
    writeFileSync(join(root, ".env"), "SECRET=1");
    writeFileSync(join(root, "x.unknownext"), "?");
    mkdirSync(join(root, "dir"));
    writeFileSync(join(root, "dir", "index.html"), "<p>i</p>");
    const app = createApp();
    app.use(serveStatic({ root, prefix: "/static" }));
    app.get("/static/fallback", () => "next");
    claim("request-response/static#serve", "prefix の下のファイルを配る", async () => {
        expect(await (await req(app, "GET", "/static/app.js")).text()).toBe("console.log(1)");
    });
    claim("request-response/static#etag-304", "弱い ETag と Last-Modified を付けて、変わっていなければ 304", async () => {
        const r = await req(app, "GET", "/static/app.js");
        const tag = r.headers.get("etag")!;
        expect(tag.startsWith("W/")).toBe(true);
        expect(r.headers.get("last-modified")).toBeTruthy();
        expect((await req(app, "GET", "/static/app.js", { headers: { "if-none-match": tag } })).status).toBe(304);
    });
    claim("request-response/static#content-type", "分からない拡張子は application/octet-stream", async () => {
        expect((await req(app, "GET", "/static/x.unknownext")).headers.get("content-type")).toBe("application/octet-stream");
    });
    claim("request-response/static#next", "当たるファイルがなければ next() を呼ぶ", async () => {
        expect(await (await req(app, "GET", "/static/fallback")).text()).toBe("next");
    });
    claim("request-response/static#dotfiles", "ドットファイルは既定で配らない", async () => {
        expect((await req(app, "GET", "/static/.env")).status).toBe(404);
    });
    claim("request-response/static#index", "フォルダは index.html", async () => {
        expect(await (await req(app, "GET", "/static/dir/")).text()).toBe("<p>i</p>");
    });
}
