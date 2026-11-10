// multipart() が、大きいファイルでメモリをためないかを手元で確かめる(CI では回さない。時間がかかるため)
// 使い方(どのランタイムでも、@senrijs/senri/serve の serve() で受け取る):
//   node --expose-gc scripts/multipart-memory.ts [MiB(既定は 500)]
//   bun scripts/multipart-memory.ts [MiB]
//   deno run -A --v8-flags=--expose-gc scripts/multipart-memory.ts [MiB]
// 本物の HTTP でチャンク転送のファイルを送り、受け取りながらメモリの最大を見る
// 受け取った大きさが合い、メモリの増え方が LIMIT_MIB より小さければ成功
// serve() の maxRequestBodySize は、送る大きさより少し大きくする(Bun の既定の 128 MiB を超えて受け取るため。
// Node.js と Deno では、本文を数えながら受け取る道を通る)
import { request as httpRequest } from "node:http";
import { createApp } from "../src/index.ts";
import { multipart } from "../src/multipart.ts";
import { serve } from "../adapters/serve/index.ts";

const MIB = 1024 * 1024;
const SIZE = Number(process.argv[2] ?? 500) * MIB;
const bun = (globalThis as { Bun?: { gc(force: boolean): void } }).Bun;
const deno = (globalThis as { Deno?: unknown }).Deno;
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

const server = await serve(app, {
    port: 0,
    hostname: "127.0.0.1",
    banner: false,
    gracefulShutdown: false,
    maxRequestBodySize: SIZE + MIB,
});

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
    const req = httpRequest({ port: server.port, host: "127.0.0.1", method: "POST", headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, "transfer-encoding": "chunked" } }, (res) => {
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
await server.stop();

const grew = (peak - base) / MIB;
let size: unknown;
try {
    size = JSON.parse(answer).size;
} catch {}
const ok = size === SIZE && grew < LIMIT_MIB;
console.log(`${runtime}: ${SIZE / MIB} MiB を ${((performance.now() - started) / 1000).toFixed(1)} 秒で受け取った。メモリの増え方の最大: ${grew.toFixed(1)} MiB(上限 ${LIMIT_MIB} MiB)`);
console.log(ok ? "成功" : `失敗: ${answer}`);
process.exit(ok ? 0 : 1);
