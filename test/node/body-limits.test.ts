// 本文の既定の上限が、Node のアダプター(Request を後で作る近道と、app.fetch を通す道)でも同じに効くか
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { bodyLimit, createApp } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";

const MIB = 1024 * 1024;

function makeApp() {
    const app = createApp();
    app.post("/text", async (_, c) => `${(await c.req.text()).length}`);
    app.post("/ignore", () => "not read");
    app.post("/swallow", async (_, c) => {
        try {
            await c.body();
        } catch {}
        return "swallowed";
    });
    // c.req.body を自分でストリームとして読む
    const stream = async (c: { req: Request }) => {
        let size = 0;
        const reader = c.req.body!.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
        }
        return String(size);
    };
    app.post("/stream", (_, c) => stream(c));
    app.use("/stream-big", bodyLimit({ maxSize: 5 * MIB }));
    app.post("/stream-big", (_, c) => stream(c));
    app.use("/big", bodyLimit({ maxSize: 5 * MIB }));
    app.post("/big", async (_, c) => `${(await c.req.text()).length}`);
    return app;
}

async function listen(target: Parameters<typeof serve>[0]) {
    const server = serve(target, { port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

// Content-Length の付かない本文
const chunked = (size: number) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (sent >= size) return controller.close();
            const n = Math.min(64 * 1024, size - sent);
            sent += n;
            controller.enqueue(new Uint8Array(n));
        },
    });
};

describe("本文の既定の上限(Node)", () => {
    const app = makeApp();
    for (const [label, target] of [
        ["近道", app],
        ["app.fetch を通す道", { fetch: app.fetch }],
    ] as const) {
        test(label, async () => {
            const { url, close } = await listen(target as never);
            const post = (path: string, body: BodyInit) => fetch(`${url}${path}`, { method: "POST", body, duplex: "half" } as RequestInit);
            try {
                assert.equal(await (await post("/text", "x".repeat(MIB))).text(), String(MIB));
                assert.equal((await post("/text", "x".repeat(MIB + 1))).status, 413);
                assert.equal((await post("/text", chunked(MIB + 1))).status, 413);
                // 読まないルートは変わらない
                assert.equal(await (await post("/ignore", "x".repeat(2 * MIB))).text(), "not read");
                // 握りつぶしても 413
                assert.equal((await post("/swallow", chunked(MIB + 1))).status, 413);
                // bodyLimit() は既定を置き換える
                assert.equal(await (await post("/big", "x".repeat(2 * MIB))).text(), String(2 * MIB));
                assert.equal(await (await post("/big", chunked(2 * MIB))).text(), String(2 * MIB));
                // c.req.body を自分で読んでも、1 MiB を超えると 413(Content-Length あり・なし)。bodyLimit() で上げられる
                assert.equal((await post("/stream", "x".repeat(2 * MIB))).status, 413);
                assert.equal((await post("/stream", chunked(2 * MIB))).status, 413);
                assert.equal(await (await post("/stream-big", "x".repeat(3 * MIB))).text(), String(3 * MIB));
                assert.equal(await (await post("/stream-big", chunked(3 * MIB))).text(), String(3 * MIB));
                // GET はそのまま
                assert.equal((await fetch(`${url}/text`)).status, 405);
            } finally {
                close();
            }
        });
    }
});
