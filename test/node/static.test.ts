// senri/static を Node 本体で動かす(bun run test:node)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
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
        assert.match(import.meta.resolve("@senrijs/senri/static"), /\/dist\/adapters\/static\/index\.js$/);
        const { createApp } = await import("@senrijs/senri");
        const { serveStatic } = await import("@senrijs/senri/static");
        const app = createApp();
        app.use(serveStatic({ root }));

        const res = await app.fetch(new Request("http://localhost/hello.txt"));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
        assert.equal(await res.text(), "こんにちは");
    });

    test('prefix の "/static/*" で、実際の HTTP でも配れる(ビルド済みの dist/)', async () => {
        const { createApp } = await import("@senrijs/senri");
        const { serveStatic } = await import("@senrijs/senri/static");
        const { serve } = await import("@senrijs/senri/node");
        const app = createApp();
        app.use(serveStatic({ root, prefix: "/static/*" }));
        const server = serve(app, { port: 0 });
        try {
            await new Promise<void>((resolve) => server.once("listening", resolve));
            const base = `http://localhost:${(server.address() as AddressInfo).port}`;

            const res = await fetch(`${base}/static/hello.txt`);
            assert.equal(res.status, 200);
            assert.equal(await res.text(), "こんにちは");
            assert.equal((await fetch(`${base}/hello.txt`)).status, 404);
        } finally {
            server.close();
        }
    });

    test("prefix の途中の * は、呼び出したときのエラー", async () => {
        const { serveStatic } = await import("@senrijs/senri/static");

        assert.throws(() => serveStatic({ root, prefix: "/a/*/b" }), /whole last segment/);
    });
});
