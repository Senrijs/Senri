// ダッシュボードの SSE が、Node のアダプター(実際の HTTP)でも流れ、切断で後片付けされるか
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/index.ts";
import { dashboardOf, devtools } from "../../src/dev/index.ts";
import { serve } from "../../adapters/node/index.ts";

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, done: (text: string) => boolean) {
    const decoder = new TextDecoder();
    let text = "";
    while (!done(text)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`途中で終わった: ${text}`);
        text += decoder.decode(chunk.value, { stream: true });
    }
    return text;
}

describe("ダッシュボード(Node)", () => {
    test("SSE でリクエストが届き、切断すると購読が外れる", async () => {
        const app = createApp({ dev: devtools() });
        app.get("/hello", () => "hi");
        const server = serve(app, { port: 0 });
        await new Promise<void>((resolve) => server.once("listening", resolve));
        // localhost(ループバック)から、Host も localhost でつなぐ
        const base = `http://localhost:${(server.address() as AddressInfo).port}`;
        const ac = new AbortController();
        try {
            const res = await fetch(`${base}/_senri/api/events`, { signal: ac.signal });
            assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
            const reader = res.body!.getReader();
            await readUntil(reader, (t) => t.includes("retry"));

            await (await fetch(`${base}/hello`)).text();
            const text = await readUntil(reader, (t) => t.includes("event: request"));
            assert.match(text, /"path":"\/hello"/);

            const log = (await dashboardOf(app))!.log;
            assert.equal(log.listenerCount, 1);
            ac.abort();
            // サーバー側が切断に気づくまで少し待つ
            for (let i = 0; i < 50 && log.listenerCount > 0; i++) await new Promise((r) => setTimeout(r, 20));
            assert.equal(log.listenerCount, 0);
        } finally {
            ac.abort();
            server.closeAllConnections();
            server.close();
        }
    });
});
