// methodOverride() を Node のアダプターで確かめる。本物のソケットから来た本文を読む
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp, methodOverride } from "../../src/index.ts";
import { getIp } from "../../src/ip.ts";
import { closeServers, counting, listen, raw } from "./http.ts";

after(closeServers);

const bodyOf = (text: string) => text.slice(text.indexOf("\r\n\r\n") + 4);
const post = (body: string, headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" }) =>
    `POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: ${body.length}\r\n${Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join("")}\r\n${body}`;

function makeApp() {
    const app = createApp();
    for (const name of ["get", "post", "put", "patch", "delete"] as const) {
        app[name]("/", async (_, c) => `${c.req.method} ${await c.req.text()}`);
    }
    return app;
}

describe("methodOverride() と Node", () => {
    test("フォームで上書きする。本文はハンドラーで読める", async () => {
        const port = await listen(methodOverride(makeApp()));

        assert.equal(bodyOf(await raw(port, post("a=1&_method=DELETE"))), "DELETE a=1&_method=DELETE");
    });

    test("チャンク転送のフォームも読む", async () => {
        const port = await listen(methodOverride(makeApp()));
        const text = "POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/x-www-form-urlencoded\r\nTransfer-Encoding: chunked\r\n\r\n8\r\n_method=\r\n3\r\nPUT\r\n0\r\n\r\n";

        assert.match(await raw(port, text), /PUT _method=PUT/);
    });

    test("ヘッダーで上書きする。読まないフォームの本文も残る", async () => {
        const port = await listen(methodOverride(makeApp()));

        assert.equal(bodyOf(await raw(port, post("x", { "X-HTTP-Method-Override": "PATCH" }))), "PATCH x");
    });

    test("上書きしない POST の本文も残る", async () => {
        const port = await listen(methodOverride(makeApp()));

        assert.equal(bodyOf(await raw(port, post("a=1"))), "POST a=1");
        assert.equal(bodyOf(await raw(port, post("_method=GET"))), "POST _method=GET");
    });

    test("64 KiB を超えるフォームは読まない。本文は全部読める", async () => {
        const port = await listen(methodOverride(makeApp()));
        const big = `_method=DELETE&x=${"a".repeat(64 * 1024)}`;

        assert.equal(bodyOf(await raw(port, post(big))), `POST ${big}`);
    });

    test("接続元を読める", async () => {
        const app = createApp();
        app.put("/", (_, c) => getIp(c) ?? "null");
        const port = await listen(methodOverride(app));

        assert.equal(bodyOf(await raw(port, post("_method=PUT"))), "127.0.0.1");
    });

    test("POST 以外も、Request と Response を作る(近道を外れる)", async () => {
        const app = createApp();
        app.get("/", () => "ok");
        const wrapped = await listen(methodOverride(app));
        const direct = await listen(app);
        const get = "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";

        const a = await counting(async () => void (await raw(wrapped, get)));
        assert.deepEqual(a, { Request: 1, Response: 1 });
        const b = await counting(async () => void (await raw(direct, get)));
        assert.deepEqual(b, { Request: 0, Response: 0 });
    });
});
