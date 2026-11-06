// uploadLimit() を Node のアダプターで確かめる。本物のソケットから来た multipart を読む
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp, safeFileName, secureHeaders, uploadLimit } from "../../src/index.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

const BOUNDARY = "BOUNDARY";
const part = (name: string, filename: string, type: string, body: string) =>
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n${body}\r\n`;
const multipart = (...parts: string[]) => `${parts.join("")}--${BOUNDARY}--\r\n`;
const post = (body: string) =>
    `POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: multipart/form-data; boundary=${BOUNDARY}\r\nContent-Length: ${Buffer.byteLength(body, "latin1")}\r\n\r\n${body}`;
const chunked = (body: string) =>
    `POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: multipart/form-data; boundary=${BOUNDARY}\r\nTransfer-Encoding: chunked\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`;
const bodyOf = (text: string) => text.slice(text.indexOf("\r\n\r\n") + 4);
const PNG = "\x89PNG\r\n\x1a\n123";

function appWith(options: Parameters<typeof uploadLimit>[0]) {
    const app = createApp();
    app.use(uploadLimit(options));
    app.post("/", async (_, c) => {
        const form = await c.body<Record<string, File>>();
        return Object.values(form).map((file) => [file.name, file.size]);
    });
    app.get("/", () => "ok");
    return app;
}

describe("uploadLimit() と Node", () => {
    test("multipart を読んで、ハンドラーに渡す", async () => {
        const port = await listen(appWith({ maxTotalSize: 1000, types: ["image/png"] }));
        const text = await raw(port, post(multipart(part("a", "a.png", "image/png", PNG))));

        assert.match(text, /^HTTP\/1\.1 200/);
        assert.equal(bodyOf(text), JSON.stringify([["a.png", PNG.length]]));
    });

    test("Content-Length で 413", async () => {
        const port = await listen(appWith({ maxTotalSize: 50 }));

        assert.match(await raw(port, post(multipart(part("a", "a.txt", "text/plain", "x".repeat(1000))))), /^HTTP\/1\.1 413/);
    });

    test("チャンク転送でも、読みながら 413", async () => {
        const port = await listen(appWith({ maxTotalSize: 50 }));

        assert.match(await raw(port, chunked(multipart(part("a", "a.txt", "text/plain", "x".repeat(1000))))), /^HTTP\/1\.1 413/);
    });

    test("チャンク転送で上限の中なら通す", async () => {
        const port = await listen(appWith({ maxTotalSize: 5000 }));

        assert.match(await raw(port, chunked(multipart(part("a", "a.txt", "text/plain", "x".repeat(1000))))), /^HTTP\/1\.1 200/);
    });

    test("種類で 415、ファイルの大きさと数で 413", async () => {
        const one = part("a", "a.png", "image/png", PNG);

        assert.match(await raw(await listen(appWith({ maxTotalSize: 1000, types: ["text/plain"] })), post(multipart(one))), /^HTTP\/1\.1 415/);
        assert.match(await raw(await listen(appWith({ maxTotalSize: 1000, maxFileSize: 2 })), post(multipart(one))), /^HTTP\/1\.1 413/);
        assert.match(await raw(await listen(appWith({ maxTotalSize: 1000, maxFiles: 1 })), post(multipart(one, part("b", "b.png", "image/png", PNG)))), /^HTTP\/1\.1 413/);
    });

    test("種類は送られた Content-Type で決まる。大文字小文字と charset は問わない。ファイル名は関係ない", async () => {
        const port = await listen(appWith({ maxTotalSize: 1000, types: ["text/plain", "image/*"], sniff: false }));

        assert.match(await raw(port, post(multipart(part("a", "a.exe", "TEXT/PLAIN; charset=utf-8", "x")))), /^HTTP\/1\.1 200/);
        assert.match(await raw(port, post(multipart(part("a", "a", "image/webp", "x")))), /^HTTP\/1\.1 200/);
        assert.match(await raw(port, post(multipart(part("a", "a.png", "text/html", "x")))), /^HTTP\/1\.1 415/);
        assert.match(await raw(port, post(multipart(part("a", "a.png", "imagex/png", "x")))), /^HTTP\/1\.1 415/);
    });

    test("偽の PNG は 415", async () => {
        const port = await listen(appWith({ maxTotalSize: 1000 }));

        assert.match(await raw(port, post(multipart(part("a", "a.png", "image/png", "<script>")))), /^HTTP\/1\.1 415/);
    });

    test("送られたファイル名は、File の name に入る。safeFileName で外に出られなくなる", async () => {
        let name = "";
        const app = createApp();
        app.use(uploadLimit({ maxTotalSize: 1000 }));
        app.post("/", async (_, c) => {
            name = (await c.body<{ a: File }>()).a.name;
            return "ok";
        });
        await raw(await listen(app), post(multipart(part("a", "../../etc/passwd", "text/plain", "x"))));

        assert.ok(name.endsWith("passwd"), name);
        assert.equal(safeFileName(name), "passwd");
    });

    test("multipart 以外は Request も Response も作らない", async () => {
        const app = appWith({ maxTotalSize: 10 });
        app.use(secureHeaders());
        const port = await listen(app);

        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/")), /^HTTP\/1\.1 200/);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("2つの道の応答が同じ", async () => {
        const { lazy, viaFetch } = await bothPaths(appWith({ maxTotalSize: 300, maxFileSize: 100, maxFiles: 2, types: ["image/png", "text/plain"] }));
        const list = [
            post(multipart(part("a", "a.png", "image/png", PNG))),
            post(multipart(part("a", "a.png", "image/png", "fake"))),
            post(multipart(part("a", "a.gif", "image/gif", "x"))),
            post(multipart(part("a", "a.txt", "text/plain", "x".repeat(200)))),
            post(multipart(part("a", "a.txt", "text/plain", "x".repeat(1000)))),
            post(multipart(part("a", "a", "text/plain", "x"), part("b", "b", "text/plain", "x"), part("c", "c", "text/plain", "x"))),
            post("not multipart"),
            chunked(multipart(part("a", "a.txt", "text/plain", "x".repeat(1000)))),
            request("GET", "/"),
        ];
        for (const text of list) assert.equal(await raw(lazy, text), await raw(viaFetch, text), text.slice(0, 150));
    });
});
