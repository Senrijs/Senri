// multipart() を Node のアダプターで、本物の HTTP で確かめる(チャンク転送で大きいファイルを送る)
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createApp } from "../../src/index.ts";
import { multipart } from "../../src/multipart.ts";
import { closeServers, listen } from "./http.ts";

after(closeServers);

const BOUNDARY = "----senri-node-boundary";
// 送るファイルの大きさ。CI では 64 MiB。手元で大きくするときは SENRI_MULTIPART_MB=500 などにする
const MIB = 1024 * 1024;
const SIZE = Number(process.env.SENRI_MULTIPART_MB ?? 64) * MIB;
const CHUNK = 64 * 1024;

// 届いたものを、ためずに数える(大きさと FNV-1a のハッシュ)
function fnv(hash: number, bytes: Uint8Array): number {
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash;
}
const chunkAt = (i: number) => new Uint8Array(CHUNK).fill(i % 251);

function makeApp() {
    const app = createApp();
    app.post("/upload", async (_, c) => {
        const parts: Record<string, unknown>[] = [];
        for await (const part of multipart(c, { maxFileSize: Infinity })) {
            if (part.filename === undefined) {
                parts.push({ name: part.name, text: await part.text() });
                continue;
            }
            let size = 0;
            let hash = 2166136261;
            const reader = part.stream.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                hash = fnv(hash, value);
            }
            parts.push({ name: part.name, filename: part.filename, size, hash });
        }
        return parts;
    });
    return app;
}

// チャンク転送で、本文を少しずつ書く(相手が読むのを待ちながら)
function upload(port: number, size: number): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            { port, host: "127.0.0.1", path: "/upload", method: "POST", headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, "transfer-encoding": "chunked" } },
            (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => resolve({ status: res.statusCode!, body }));
            },
        );
        req.on("error", reject);
        const write = (data: string | Uint8Array) => new Promise<void>((done) => (req.write(data) ? done() : req.once("drain", done)));
        (async () => {
            await write(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="title"\r\n\r\nこんにちは\r\n`);
            await write(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
            for (let i = 0; i * CHUNK < size; i++) await write(chunkAt(i));
            await write(`\r\n--${BOUNDARY}--\r\n`);
            req.end();
        })().catch(reject);
    });
}

describe("multipart()(Node、本物の HTTP)", () => {
    test(`${SIZE / MIB} MiB のファイルを、チャンク転送で受け取れる`, { timeout: 120_000 }, async () => {
        let expected = 2166136261;
        for (let i = 0; i * CHUNK < SIZE; i++) expected = fnv(expected, chunkAt(i));
        const port = await listen(makeApp());

        const res = await upload(port, SIZE);

        assert.equal(res.status, 200, res.body);
        assert.deepEqual(JSON.parse(res.body), [
            { name: "title", text: "こんにちは" },
            { name: "file", filename: "big.bin", size: SIZE, hash: expected },
        ]);
    });

    test("上限を超えたら 413", async () => {
        const app = createApp();
        app.post("/upload", async (_, c) => {
            for await (const part of multipart(c, { maxFileSize: 10 })) await part.bytes();
            return "ok";
        });
        const port = await listen(app);
        const body = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f"; filename="a"\r\n\r\n${"x".repeat(11)}\r\n--${BOUNDARY}--\r\n`;
        const res = await fetch(`http://127.0.0.1:${port}/upload`, { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` }, body });

        assert.equal(res.status, 413);
        assert.equal(await res.text(), "413 Content Too Large");
    });

    test("ブラウザと同じ FormData を fetch で送っても読める", async () => {
        const port = await listen(makeApp());
        const form = new FormData();
        form.append("title", "a");
        form.append("file", new File([new Uint8Array(CHUNK).fill(7)], "写真.png", { type: "image/png" }));
        const res = await fetch(`http://127.0.0.1:${port}/upload`, { method: "POST", body: form });
        const parts = await res.json();

        assert.deepEqual(parts[0], { name: "title", text: "a" });
        assert.equal(parts[1].filename, "写真.png");
        assert.equal(parts[1].size, CHUNK);
    });
});
