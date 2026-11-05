// Node 本体で動かすアダプターのテスト(bun run test:node)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import net, { type AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";
import { getIp } from "../../src/ip.ts";
import { setCookie } from "../../src/cookie.ts";

const app = createApp();
app.get("/hello", () => "hi");
app.get("/url", (_, c) => c.req.url);
app.post("/echo", async (_, c) => `body=${await c.req.text()}`);
app.on("QUERY", "/search", async (_, c) => `query=${await c.req.text()}`);
app.all("/anything", (_, c) => c.req.method);
app.get("/ip", (_, c) => getIp(c) ?? "unknown");
app.get("/cookies", () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    return new Response("ok", { headers });
});
app.get("/page", (_, c) => c.html("<h1>こんにちは</h1>"));
app.get("/login", (_, c) => {
    setCookie(c, "session", "abc");
    setCookie(c, "seen", "1");
    return c.redirect("/hello?from=login", 303);
});
app.get("/to/japanese", (_, c) => c.redirect("/日本語?q=あ"));
app.get("/to/idn", (_, c) => c.redirect("https://例え.jp/パス"));
app.get("/to/surrogate", (_, c) => c.redirect("/\ud800"));
app.get("/to/crlf", (_, c) => c.redirect("/a\r\nSet-Cookie: x=1"));
app.get("/items/:id", (_, c) => {
    setCookie(c, "session", "abc");
    setCookie(c, "seen", "1");
    return c.notFound();
});
app.use("/hidden", (c) => c.notFound());
app.get("/hidden", () => "ここには来ない");
app.use("/admin/*", (c, next) => {
    if (c.req.headers.get("authorization") !== "secret") {
        c.status(401);
        return "ログインしてね";
    }
    return next();
});
app.get("/admin/secret", () => "秘密のデータ");
app.get("/assets/*", ({ "*": rest }) => `assets: ${rest}`);

// 1チャンク目を送ったあと、テストが release() を呼ぶまで止まるストリーム
let release = () => {};
app.get("/stream", () => {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode("first"));
            release = () => controller.close();
        },
    });
    return new Response(body);
});

// クライアントが切断したら c.req.signal が abort されるか
let sawAbort: Promise<void> = Promise.resolve();
app.get("/wait", (_, c) => {
    sawAbort = new Promise((resolve) => c.req.signal.addEventListener("abort", () => resolve()));
    return sawAbort.then(() => "aborted");
});

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.get("/one/text", () => "hello");
app.get("/one/json", () => ({ a: 1 }));
app.get("/one/bytes", () => new Uint8Array([1, 2, 3]));
app.get("/one/empty", () => new Response(""));
app.get("/no-content", () => new Response(null, { status: 204 }));
app.get("/not-modified", () => new Response(null, { status: 304, headers: { etag: '"a"' } }));
app.get("/one/length", () => new Response("hello", { headers: { "content-length": "5" } }));
app.get("/one/cookies", (_, c) => {
    setCookie(c, "a", "1");
    setCookie(c, "b", "2");
    return "ok";
});

// SSE: 2つ目のイベントは、テストが release2() を呼ぶまで送らない
let release2 = () => {};
app.get("/sse", () => {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(bytes("data: 1\n\n"));
            release2 = () => {
                controller.enqueue(bytes("data: 2\n\n"));
                controller.close();
            };
        },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
});

// 2つ目のチャンクが、最初の読み取りから何ティックかあとに届く。判定の境目でチャンクが欠けないことを確かめる
app.get("/late/:ticks", ({ ticks }) => {
    const body = new ReadableStream({
        async start(controller) {
            controller.enqueue(bytes("a"));
            for (let i = 0; i < Number(ticks); i++) await null;
            controller.enqueue(bytes("b"));
            for (let i = 0; i < Number(ticks); i++) await null;
            controller.enqueue(bytes("c"));
            controller.close();
        },
    });
    return new Response(body);
});
app.get("/many", () => {
    const body = new ReadableStream({
        start(controller) {
            for (let i = 0; i < 2000; i++) controller.enqueue(bytes(`${i},`));
            controller.close();
        },
    });
    return new Response(body);
});

// どこまで引かれたかを見る、大きな本文
let pulled = 0;
app.get("/big", () => {
    pulled = 0;
    const body = new ReadableStream(
        {
            pull(controller) {
                pulled++;
                controller.enqueue(new Uint8Array(64 * 1024));
                if (pulled >= 3000) controller.close();
            },
        },
        { highWaterMark: 0 },
    );
    return new Response(body);
});

// 切断したら、本文の cancel が呼ばれるか(c.req.signal を読まなくても)
let cancelled: Promise<void> = Promise.resolve();
app.get("/forever", () => {
    let done = () => {};
    cancelled = new Promise((resolve) => (done = resolve));
    const body = new ReadableStream({
        start: (controller) => controller.enqueue(bytes("data: 1\n\n")),
        cancel: () => done(),
    });
    return new Response(body);
});

app.get("/fail/first", (_, c) => {
    setCookie(c, "session", "abc");
    const body = new ReadableStream({ start: (controller) => controller.error(new Error("本文の失敗")) });
    return new Response(body, { headers: { "content-type": "text/event-stream", "x-mark": "1" } });
});
app.get("/fail/later", () => {
    const body = new ReadableStream({
        async start(controller) {
            controller.enqueue(bytes("part"));
            await sleep(20);
            controller.error(new Error("本文の失敗"));
        },
    });
    return new Response(body);
});

app.get("/headers", (_, c) => ({ ...Object.fromEntries(c.req.headers), cookies: c.req.headers.getSetCookie() }));

let server: Server;
let port: number;
let base: string;

before(async () => {
    server = serve(app, { port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
    base = `http://localhost:${port}`;
});

after(() => {
    server.close();
});

// fetch では送れない生の HTTP リクエストを送る
function raw(request: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const sock = net.connect(port, "localhost", () => sock.write(request));
        let data = "";
        sock.on("data", (d) => (data += d));
        sock.on("end", () => resolve(data));
        sock.on("error", reject);
    });
}

describe("Node アダプター", () => {
    test("hostname を渡すと、そのアドレスで待ち受ける", async () => {
        const s = serve(app, { port: 0, hostname: "127.0.0.1" });
        try {
            await new Promise<void>((resolve) => s.once("listening", resolve));
            assert.equal((s.address() as AddressInfo).address, "127.0.0.1");
        } finally {
            s.close();
        }
    });

    test("GET でテキストが返る", async () => {
        const res = await fetch(`${base}/hello`);

        assert.equal(res.status, 200);
        assert.equal(await res.text(), "hi");
    });

    test("不正な Host ヘッダーでも落ちずに 400 を返す", async () => {
        const res = await raw("GET /hello HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n");

        assert.match(res, /^HTTP\/1\.1 400/);
        // サーバーはまだ生きている
        assert.equal((await fetch(`${base}/hello`)).status, 200);
    });

    test("Host ヘッダーに URL の区切り文字があっても、パスがすり替わらない(400)", async () => {
        // "x/admin#" をそのままつなぐと http://x/admin#/hello になり、パスが /admin に化ける
        for (const host of ["x/admin#", "x/admin?", "x@evil", "x\\admin"]) {
            const res = await raw(`GET /hello HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
            assert.match(res, /^HTTP\/1\.1 400/, `Host: ${host}`);
        }
    });

    test("Host ヘッダーがなくても動く(HTTP/1.0)", async () => {
        const res = await raw("GET /url HTTP/1.0\r\n\r\n");

        assert.match(res, /^HTTP\/1\.1 200/);
        assert.match(res, /http:\/\/localhost\/url$/);
    });

    test("absolute-form のリクエストでもパスが壊れない", async () => {
        const res = await raw(`GET http://localhost:${port}/hello HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);

        assert.match(res, /^HTTP\/1\.1 200/);
        // 本文は chunked で来ることもあるので、ヘッダーのあとに含まれていればよい
        assert.match(res.split("\r\n\r\n")[1]!, /\bhi\b/);
    });

    test("// で始まるパスが、ホスト名として解釈されない", async () => {
        const res = await raw(`GET //url HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);

        assert.match(res, /^HTTP\/1\.1 200/);
        assert.match(res.split("\r\n\r\n")[1]!, new RegExp(`http://localhost:${port}//url`));
    });

    test("/ で始まらないリクエストターゲットは 400", async () => {
        const res = await raw(`GET @evil.example/url HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);

        assert.match(res, /^HTTP\/1\.1 400/);
    });

    test("POST のボディがアプリに届く", async () => {
        const res = await fetch(`${base}/echo`, { method: "POST", body: "こんにちは" });

        assert.equal(await res.text(), "body=こんにちは");
    });

    test("c.html() が text/html で届く", async () => {
        const res = await fetch(`${base}/page`);

        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(await res.text(), "<h1>こんにちは</h1>");
    });

    test("c.redirect() の相対パスと Cookie がそのまま届く", async () => {
        const res = await fetch(`${base}/login`, { redirect: "manual" });

        assert.equal(res.status, 303);
        assert.equal(res.headers.get("location"), "/hello?from=login");
        assert.deepEqual(res.headers.getSetCookie(), [
            "session=abc; Path=/; HttpOnly; SameSite=Lax",
            "seen=1; Path=/; HttpOnly; SameSite=Lax",
        ]);
        assert.equal(await res.text(), "");
    });

    test("c.redirect() の ASCII 以外は、エンコードして届く", async () => {
        const location = async (path: string) => (await fetch(`${base}${path}`, { redirect: "manual" })).headers.get("location");

        assert.equal(await location("/to/japanese"), "/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%E3%81%82");
        assert.equal(await location("/to/idn"), "https://xn--r8jz45g.jp/%E3%83%91%E3%82%B9");
    });

    test("c.redirect() に使えない値は 500 になり、ヘッダーは足されない", async () => {
        for (const path of ["/to/surrogate", "/to/crlf"]) {
            const res = await raw(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);

            assert.match(res, /^HTTP\/1\.1 500/);
            assert.doesNotMatch(res, /^location:/im);
            assert.doesNotMatch(res, /^set-cookie:/im);
        }
    });

    test("ワイルドカードのルート: 残りのパスを受け取れる", async () => {
        const text = async (path: string) => {
            const res = await fetch(`${base}${path}`);
            assert.equal(res.status, 200);
            return res.text();
        };

        assert.equal(await text("/assets"), "assets: ");
        assert.equal(await text("/assets/a/b"), "assets: a/b");
        assert.equal(await text("/assets/%E3%81%82"), "assets: あ");
        assert.equal(await text("/assets/%252F"), "assets: %2F");
    });

    test("ワイルドカードのルート: %2F は 400、メソッドが違えば 404", async () => {
        assert.equal((await fetch(`${base}/assets/a%2Fb`)).status, 400);
        assert.equal((await fetch(`${base}/assets/a`, { method: "POST" })).status, 404);
        assert.equal((await fetch(`${base}/assets/a`, { method: "OPTIONS" })).status, 404);
    });

    test('use("/admin/*") の認証が動く', async () => {
        const denied = await fetch(`${base}/admin/secret`);
        assert.equal(denied.status, 401);
        assert.equal(await denied.text(), "ログインしてね");

        const allowed = await fetch(`${base}/admin/secret`, { headers: { authorization: "secret" } });
        assert.equal(allowed.status, 200);
        assert.equal(await allowed.text(), "秘密のデータ");
    });

    test("c.notFound() が 404 で届き、Cookie も付く", async () => {
        const res = await fetch(`${base}/items/1`);

        assert.equal(res.status, 404);
        assert.equal(await res.text(), "404 Not Found");
        assert.deepEqual(res.headers.getSetCookie(), [
            "session=abc; Path=/; HttpOnly; SameSite=Lax",
            "seen=1; Path=/; HttpOnly; SameSite=Lax",
        ]);
    });

    test("ミドルウェアの c.notFound() も 404 で届く", async () => {
        const res = await fetch(`${base}/hidden`);

        assert.equal(res.status, 404);
        assert.equal(await res.text(), "404 Not Found");
    });

    test("c.notFound() は app.notFound のハンドラーに回る", async () => {
        const custom = createApp();
        custom.notFound((c) => c.json({ error: "ありません", path: c.path }));
        custom.get("/items/:id", (_, c) => c.notFound());
        const s = serve(custom, { port: 0 });
        try {
            await new Promise<void>((resolve) => s.once("listening", resolve));
            const res = await fetch(`http://localhost:${(s.address() as AddressInfo).port}/items/1`);

            assert.equal(res.status, 404);
            assert.deepEqual(await res.json(), { error: "ありません", path: "/items/1" });
        } finally {
            s.close();
        }
    });

    test("c.notFound() の HEAD は本文を送らない", async () => {
        const res = await raw("HEAD /items/1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        const [head, body] = res.split("\r\n\r\n");

        assert.match(head!, /^HTTP\/1\.1 404/);
        assert.match(head!, /^set-cookie: session=abc/im);
        assert.equal(body, "");
    });

    test("Set-Cookie が複数あっても全部届く", async () => {
        const res = await fetch(`${base}/cookies`);

        assert.deepEqual(res.headers.getSetCookie(), ["a=1", "b=2"]);
    });

    test("レスポンスを最後まで待たずに流す(ストリーミング)", async () => {
        const res = await fetch(`${base}/stream`);
        const reader = res.body!.getReader();

        const { value } = await reader.read();
        assert.equal(new TextDecoder().decode(value), "first");

        release();
        assert.equal((await reader.read()).done, true);
    });

    // ヘッダーと本文に分ける(生の HTTP)
    async function rawResponse(method: string, path: string, extra = "") {
        const text = await raw(`${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${extra}\r\n`);
        const end = text.indexOf("\r\n\r\n");
        return { head: text.slice(0, end), body: text.slice(end + 4) };
    }
    const silently = async <T>(run: () => Promise<T>): Promise<T> => {
        const original = console.error;
        console.error = () => {};
        try {
            return await run();
        } finally {
            console.error = original;
        }
    };

    for (const [path, length] of [
        ["/one/text", 5],
        ["/one/json", 7],
        ["/one/bytes", 3],
        ["/one/length", 5],
        ["/nope", 13],
    ] as const) {
        test(`1チャンクの本文(${path})は Content-Length で送る`, async () => {
            const { head, body } = await rawResponse("GET", path);

            assert.match(head, new RegExp(`^content-length: ${length}$`, "im"));
            assert.doesNotMatch(head, /^transfer-encoding/im);
            assert.equal(body.length, length);
        });
    }

    test("空の本文でも応答が終わる", async () => {
        const { head, body } = await rawResponse("GET", "/one/empty");

        assert.match(head, /^HTTP\/1\.1 200/);
        assert.match(head, /^content-length: 0$/im);
        assert.equal(body, "");
    });

    test("Set-Cookie が複数あっても、Content-Length で送れる", async () => {
        const { head } = await rawResponse("GET", "/one/cookies");

        assert.equal(head.match(/^set-cookie: /gim)?.length, 2);
        assert.match(head, /^content-length: 2$/im);
    });

    test("HEAD は本文を送らない", async () => {
        for (const path of ["/one/text", "/nope"]) {
            const { head, body } = await rawResponse("HEAD", path);

            assert.equal(body, "", path);
            assert.doesNotMatch(head, /^transfer-encoding/im, path);
        }
    });

    test("204 と 304 は本文を送らない", async () => {
        const noContent = await rawResponse("GET", "/no-content");
        assert.match(noContent.head, /^HTTP\/1\.1 204/);
        assert.equal(noContent.body, "");

        const notModified = await rawResponse("GET", "/not-modified");
        assert.match(notModified.head, /^HTTP\/1\.1 304/);
        assert.match(notModified.head, /^etag: "a"$/im);
        assert.equal(notModified.body, "");
    });

    test("SSE: 最初のイベントは、次のイベントを待たずに届く", async () => {
        const res = await fetch(`${base}/sse`);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        assert.equal(res.headers.get("content-type"), "text/event-stream");
        assert.equal(res.headers.get("content-length"), null);
        // release2() を呼ぶ前に届く
        assert.equal(decoder.decode((await reader.read()).value), "data: 1\n\n");

        release2();
        assert.equal(decoder.decode((await reader.read()).value), "data: 2\n\n");
        assert.equal((await reader.read()).done, true);
    });

    test("チャンクがいつ届いても、欠けず、順番も変わらない", async () => {
        for (let ticks = 0; ticks <= 16; ticks++) {
            for (let n = 0; n < 5; n++) {
                assert.equal(await (await fetch(`${base}/late/${ticks}`)).text(), "abc", `ticks=${ticks}`);
            }
        }
    });

    test("同じティックの大量のチャンクも、欠けず、順番も変わらない", async () => {
        const nums = (await (await fetch(`${base}/many`)).text()).split(",").filter(Boolean).map(Number);

        assert.equal(nums.length, 2000);
        assert.ok(nums.every((n, i) => n === i));
    });

    test("バックプレッシャー: 読まないクライアントには、本文を引き続けない", async () => {
        const socket = net.connect(port, "localhost", () => socket.write("GET /big HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
        socket.pause();
        try {
            await sleep(300);
            // 全部で 3000 個。ソケットのバッファに入る分しか引かない
            assert.ok(pulled > 0 && pulled < 100, `pulled=${pulled}`);
        } finally {
            socket.destroy();
        }
    });

    test("切断すると、c.req.signal を読まなくても本文の cancel が呼ばれる", async () => {
        const controller = new AbortController();
        const res = await fetch(`${base}/forever`, { signal: controller.signal });
        await res.body!.getReader().read();

        controller.abort();

        await Promise.race([
            cancelled,
            sleep(2000).then(() => {
                throw new Error("cancel が呼ばれなかった");
            }),
        ]);
    });

    test("本文の最初の読み取りで失敗したら 500 で、失敗したレスポンスのヘッダーは残さない", async () => {
        const { head, body } = await silently(() => rawResponse("GET", "/fail/first"));

        assert.match(head, /^HTTP\/1\.1 500/);
        assert.equal(body, "500 Internal Server Error");
        assert.doesNotMatch(head, /^content-type/im);
        assert.doesNotMatch(head, /^set-cookie/im);
        assert.doesNotMatch(head, /^x-mark/im);
        // サーバーはまだ生きている
        assert.equal((await fetch(`${base}/hello`)).status, 200);
    });

    test("本文の途中で失敗したら、接続を切る(完了したように見せない)", async () => {
        const text = await silently(() => raw("GET /fail/later HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));

        assert.match(text, /^HTTP\/1\.1 200/);
        assert.match(text, /part/);
        // チャンク形式の終わり("0\r\n\r\n")が来ていない
        assert.doesNotMatch(text, /\r\n0\r\n\r\n$/);
        assert.equal((await fetch(`${base}/hello`)).status, 200);
    });

    test("リクエストのヘッダー: 同じ名前は Node と同じようにまとめ、Set-Cookie も届く", async () => {
        const { body } = await rawResponse("GET", "/headers", "X-A: 1\r\nX-A: 2\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\nCookie: c=3\r\nCookie: d=4\r\n");
        const seen = JSON.parse(body);

        assert.equal(seen["x-a"], "1, 2");
        assert.deepEqual(seen.cookies, ["a=1", "b=2"]);
        assert.equal(seen.cookie, "c=3; d=4");
    });

    test("リクエストのヘッダー: Set-Cookie がないときも、ふつうに読める", async () => {
        const { body } = await rawResponse("GET", "/headers", "X-A: 1\r\nAuthorization: Bearer abc\r\n");
        const seen = JSON.parse(body);

        assert.equal(seen["x-a"], "1");
        assert.equal(seen.authorization, "Bearer abc");
        assert.equal(seen.host, "localhost");
    });

    test("クライアントが切断すると c.req.signal が abort される", async () => {
        const controller = new AbortController();
        const pending = fetch(`${base}/wait`, { signal: controller.signal }).catch(() => {});
        await new Promise((r) => setTimeout(r, 100));

        controller.abort();
        await pending;

        await sawAbort;
    });

    test("app.fetch の2つ目の引数に、接続元のアドレスを Deno と同じ形で渡す", async () => {
        let seen: unknown;
        const probe = serve(
            {
                fetch: (_req: Request, info?: unknown) => {
                    seen = info;
                    return new Response("ok");
                },
            },
            { port: 0 },
        );
        await new Promise<void>((resolve) => probe.once("listening", resolve));
        const probePort = (probe.address() as AddressInfo).port;

        await (await fetch(`http://127.0.0.1:${probePort}/`)).text();
        probe.close();

        const hostname = (seen as { remoteAddr?: { hostname?: string } })?.remoteAddr?.hostname ?? "";
        assert.match(hostname, /^(::ffff:)?127\.0\.0\.1$|^::1$/);
    });

    test("アプリが reject しても 500 を返して落ちない", async () => {
        const broken = serve({ fetch: () => Promise.reject(new Error("boom")) }, { port: 0 });
        await new Promise<void>((resolve) => broken.once("listening", resolve));
        const brokenPort = (broken.address() as AddressInfo).port;

        const res = await fetch(`http://localhost:${brokenPort}/`);
        broken.close();

        assert.equal(res.status, 500);
    });

    test("c.ip で接続元のアドレスが読める", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/ip`);

        assert.equal(await res.text(), "127.0.0.1");
    });

    test("QUERY のボディがアプリに届く", async () => {
        const res = await fetch(`${base}/search`, {
            method: "QUERY",
            headers: { "content-type": "application/json" },
            body: `{"q":"senri"}`,
        });

        assert.equal(await res.text(), `query={"q":"senri"}`);
    });

    test("ボディのない QUERY は 400(空のストリームにしない)", async () => {
        const res = await raw(
            `QUERY /search HTTP/1.1\r\nHost: localhost:${port}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n`,
        );

        assert.match(res, /^HTTP\/1\.1 400/);
    });

    for (const method of ["TRACE", "TRACK"]) {
        test(`${method} は 501 Not Implemented`, async () => {
            const res = await raw(`${method} /anything HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);

            assert.match(res, /^HTTP\/1\.1 501/);
        });
    }

    test("CONNECT は 501 Not Implemented", async () => {
        const res = await raw(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n`);

        assert.match(res, /^HTTP\/1\.1 501/);
    });

    test("Node が知らないメソッドは 501 Not Implemented", async () => {
        const res = await raw(`FOOBAR /anything HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);

        assert.match(res, /^HTTP\/1\.1 501/);
    });
});
