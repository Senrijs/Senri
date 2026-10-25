// パッケージとして使われたときの形を確かめる(bun run build のあとに動かす)
// "senri" はパッケージの自己参照なので、package.json の exports がそのまま使われる
import { describe, test } from "node:test";
import assert from "node:assert/strict";

describe("パッケージ", () => {
    test('"senri" はビルド済みの dist/ の .js を指す', () => {
        // node_modules に入ったとき、Node は .ts の型を外してくれないので .js でないといけない
        assert.match(import.meta.resolve("senri"), /\/dist\/src\/index\.js$/);
    });

    test('"senri/node" で Node アダプターが使える', async () => {
        assert.match(import.meta.resolve("senri/node"), /\/dist\/adapters\/node\/index\.js$/);
        const { serve } = await import("senri/node");

        assert.equal(typeof serve, "function");
    });

    test("ビルド済みのコードでアプリが動く", async () => {
        const { createApp } = await import("senri");
        const app = createApp();
        app.get("/users/:id", ({ id }) => `user ${id}`);

        const res = await app.fetch(new Request("http://localhost/users/42"));

        assert.equal(await res.text(), "user 42");
    });
});
