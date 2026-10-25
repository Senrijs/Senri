// serve() が Node 本体でも動くか(Node では node:http のアダプターを使う)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { serve } from "../../adapters/serve/index.ts";

const app = createApp();
app.get("/hello", () => "hi");

describe("serve(Node)", () => {
    test("port: 0 でも、実際に待ち受けたポートが url と port に入る", async () => {
        const server = await serve(app, { port: 0, banner: false });
        try {
            assert.ok(server.port > 0);
            assert.equal(server.url, `http://localhost:${server.port}`);
            assert.equal(await (await fetch(`${server.url}/hello`)).text(), "hi");
        } finally {
            await server.stop();
        }
    });

    test("使用中のポートなら、プロセスを落とさずに reject する", async () => {
        const first = await serve(app, { port: 0, banner: false });
        try {
            await assert.rejects(serve(app, { port: first.port, banner: false }), /EADDRINUSE/);
        } finally {
            await first.stop();
        }
    });
});
