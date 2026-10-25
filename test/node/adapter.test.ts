// Node 本体で動かすアダプターのテスト(bun run test:node)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import net, { type AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";

const app = createApp();
app.get("/hello", () => "hi");
app.get("/url", (_, c) => c.req.url);
app.post("/echo", async (_, c) => `body=${await c.req.text()}`);

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

    test("Host ヘッダーがなくても動く(HTTP/1.0)", async () => {
        const res = await raw("GET /url HTTP/1.0\r\n\r\n");

        assert.match(res, /^HTTP\/1\.1 200/);
        assert.match(res, /http:\/\/localhost\/url$/);
    });

    test("absolute-form のリクエストでもパスが壊れない", async () => {
        const res = await raw(`GET http://localhost:${port}/hello HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);

        assert.match(res, /^HTTP\/1\.1 200/);
        assert.match(res, /hi$/);
    });

    test("POST のボディがアプリに届く", async () => {
        const res = await fetch(`${base}/echo`, { method: "POST", body: "こんにちは" });

        assert.equal(await res.text(), "body=こんにちは");
    });

    test("アプリが reject しても 500 を返して落ちない", async () => {
        const broken = serve({ fetch: () => Promise.reject(new Error("boom")) }, { port: 0 });
        await new Promise<void>((resolve) => broken.once("listening", resolve));
        const brokenPort = (broken.address() as AddressInfo).port;

        const res = await fetch(`http://localhost:${brokenPort}/`);
        broken.close();

        assert.equal(res.status, 500);
    });
});
