// multipart() が、大きいファイルでメモリをためないかを手元で確かめる(CI では回さない。時間がかかるため)
// 使い方(どのランタイムでも、そのランタイムのサーバーで受け取る):
//   node --expose-gc scripts/multipart-memory.ts [MiB(既定は 500)]                 … @senrijs/senri/node の serve
//   bun scripts/multipart-memory.ts [MiB]                                            … Bun.serve({ fetch: app.fetch })
//   deno run -A --v8-flags=--expose-gc scripts/multipart-memory.ts [MiB]             … Deno.serve(app.fetch)
// 本物の HTTP でチャンク転送のファイルを送り、受け取りながらメモリの最大を見る
// 受け取った大きさが合い、メモリの増え方が LIMIT_MIB より小さければ成功
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/index.ts";
import { multipart } from "../src/multipart.ts";
import { serve } from "../adapters/node/index.ts";

const MIB = 1024 * 1024;
const SIZE = Number(process.argv[2] ?? 500) * MIB;
type BunLike = { gc(force: boolean): void; serve(o: { port: number; hostname: string; maxRequestBodySize: number; fetch: (r: Request) => Promise<Response> }): { port: number; stop(): void } };
type DenoLike = { serve(o: { port: number; hostname: string; onListen(): void }, h: (r: Request) => Promise<Response>): { addr: { port: number }; shutdown(): Promise<void> } };
const bun = (globalThis as { Bun?: BunLike }).Bun;
const deno = (globalThis as { Deno?: DenoLike }).Deno;
const runtime = bun ? "Bun" : deno ? "Deno" : "Node.js";
const CHUNK = 64 * 1024;
const LIMIT_MIB = 100;
const BOUNDARY = "----senri-memory";

const gc = bun ? () => bun.gc(true) : (globalThis as { gc?: () => void }).gc;
if (!gc) {
    console.error("GC を呼べるように動かしてください(node --expose-gc、deno run --v8-flags=--expose-gc)");
    process.exit(1);
}

const app = createApp();
app.post("/", async (_, c) => {
    let size = 0;
    for await (const part of multipart(c, { maxFileSize: Infinity })) {
        const reader = part.stream.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
        }
    }
    return { size };
});

// そのランタイムのサーバーで受け取る
let port: number;
let close: () => unknown;
if (bun) {
    // Bun.serve はリクエストのボディを既定で 128 MiB までにしている(超えると接続を切る)。大きいファイルを受けるときは上げる
    const server = bun.serve({ port: 0, hostname: "127.0.0.1", maxRequestBodySize: SIZE + MIB, fetch: app.fetch });
    port = server.port;
    close = () => server.stop();
} else if (deno) {
    let listening!: () => void;
    const ready = new Promise<void>((resolve) => (listening = resolve));
    const server = deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => listening() }, app.fetch);
    await ready;
    port = server.addr.port;
    close = () => server.shutdown();
} else {
    const server = serve(app, { port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
    close = () => server.close();
}

const used = () => {
    const m = process.memoryUsage();
    return m.heapUsed + m.arrayBuffers;
};
gc();
const base = used();
let peak = base;
const sampler = setInterval(() => (peak = Math.max(peak, used())), 50);

const started = performance.now();
const answer = await new Promise<string>((resolve, reject) => {
    const req = httpRequest({ port, host: "127.0.0.1", method: "POST", headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, "transfer-encoding": "chunked" } }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    const write = (data: string | Uint8Array) => new Promise<void>((done) => (req.write(data) ? done() : req.once("drain", done)));
    (async () => {
        await write(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n\r\n`);
        const chunk = new Uint8Array(CHUNK).fill(1);
        for (let sent = 0; sent < SIZE; sent += CHUNK) await write(chunk);
        await write(`\r\n--${BOUNDARY}--\r\n`);
        req.end();
    })().catch(reject);
});
clearInterval(sampler);
await close();

const grew = (peak - base) / MIB;
const ok = JSON.parse(answer).size === SIZE && grew < LIMIT_MIB;
console.log(`${runtime}: ${SIZE / MIB} MiB を ${((performance.now() - started) / 1000).toFixed(1)} 秒で受け取った。メモリの増え方の最大: ${grew.toFixed(1)} MiB(上限 ${LIMIT_MIB} MiB)`);
console.log(ok ? "成功" : `失敗: ${answer}`);
process.exit(ok ? 0 : 1);
