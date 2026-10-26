// senri/static を Node 本体で動かす(bun run test:node)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;

before(async () => {
    root = await mkdtemp(join(tmpdir(), "senri-static-node-"));
    await writeFile(join(root, "hello.txt"), "こんにちは");
});

after(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("senri/static(Node)", () => {
    test("ビルド済みの dist/ を指し、ファイルを返せる", async () => {
        assert.match(import.meta.resolve("senri/static"), /\/dist\/adapters\/static\/index\.js$/);
        const { createApp } = await import("senri");
        const { serveStatic } = await import("senri/static");
        const app = createApp();
        app.use(serveStatic({ root }));

        const res = await app.fetch(new Request("http://localhost/hello.txt"));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
        assert.equal(await res.text(), "こんにちは");
    });
});
