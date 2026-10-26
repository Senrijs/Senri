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

    test("stop() は処理中のリクエストを待つ(keep-alive の接続が残っていても止まる)", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => (release = resolve));
        const slowApp = createApp();
        slowApp.get("/slow", async () => {
            await gate;
            return "done";
        });
        slowApp.get("/fast", () => "fast");
        const server = await serve(slowApp, { port: 0, banner: false });
        // keep-alive の接続を1本作っておく(使っていない接続で close() が止まらないこと)
        await (await fetch(`${server.url}/fast`)).text();
        const slow = fetch(`${server.url}/slow`);
        await new Promise((r) => setTimeout(r, 100));
        const stopped = server.stop();
        release();
        assert.equal(await (await slow).text(), "done");
        await stopped;
    });

    test("shutdownTimeout を過ぎたら、残りの接続を切って止まる", async () => {
        const hangApp = createApp();
        hangApp.get("/hang", () => new Promise<string>(() => {}));
        const server = await serve(hangApp, { port: 0, banner: false, shutdownTimeout: 200 });
        const hanging = fetch(`${server.url}/hang`).then(
            () => "answered",
            () => "cut",
        );
        await new Promise((r) => setTimeout(r, 100));
        await server.stop();
        assert.equal(await hanging, "cut");
    });
});
