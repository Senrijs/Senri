// serve() が Node 本体でも動くか(Node では node:http のアダプターを使う)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
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

    test("hostname を node:http に渡し、そのアドレスだけで待ち受ける", async () => {
        const server = await serve(app, { port: 0, hostname: "127.0.0.1", banner: false });
        try {
            assert.equal(server.url, `http://127.0.0.1:${server.port}`);
            assert.equal(await (await fetch(`${server.url}/hello`)).text(), "hi");
            // ほかのアドレス(IPv6 のループバック)からはつながらない
            // (以前は hostname を無視して全部のアドレスで待ち受けていたので、つながった)
            const reached = await new Promise<boolean>((resolve) => {
                const sock = net.connect(server.port, "::1", () => {
                    sock.destroy();
                    resolve(true);
                });
                sock.on("error", () => resolve(false));
            });
            assert.equal(reached, false);
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

    // シグナルは process.emit で送り、process.exit は差し替えて呼ばれた code だけ記録する(テストのプロセスを終わらせない)
    test("止まっている途中で2回目のシグナルを受けたら、待たずに exit(1) する", async () => {
        const hangApp = createApp();
        hangApp.get("/hang", () => new Promise<string>(() => {}));
        const exits: number[] = [];
        const realExit = process.exit;
        process.exit = ((code?: number) => {
            exits.push(code ?? 0);
        }) as typeof process.exit;
        const before = process.listenerCount("SIGTERM");
        try {
            const server = await serve(hangApp, { port: 0, banner: false, shutdownTimeout: 300 });
            const hanging = fetch(`${server.url}/hang`).catch(() => "cut");
            await new Promise((r) => setTimeout(r, 100));

            process.emit("SIGTERM");
            // 1回目: 処理中のリクエストを待っているので、まだ終わらない
            assert.deepEqual(exits, []);
            process.emit("SIGTERM");
            // 2回目: 待たずに終わる
            assert.deepEqual(exits, [1]);

            // 後始末: 時間切れで止まり終わると、onShutdown のあと exit(0) が呼ばれ、シグナルの受け口も外れる
            await server.stop();
            await hanging;
            await new Promise((r) => setTimeout(r, 0));
            assert.deepEqual(exits, [1, 0]);
            assert.equal(process.listenerCount("SIGTERM"), before);
        } finally {
            process.exit = realExit;
        }
    });

    test("stop() で止まり終わったら、シグナルの受け口を外す", async () => {
        const before = process.listenerCount("SIGTERM");
        const server = await serve(app, { port: 0, banner: false });
        assert.equal(process.listenerCount("SIGTERM"), before + 1);
        await server.stop();
        assert.equal(process.listenerCount("SIGTERM"), before);
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
