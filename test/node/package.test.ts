// パッケージとして使われたときの形を確かめる(bun run build のあとに動かす)
// "senri" はパッケージの自己参照なので、package.json の exports がそのまま使われる
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

    test("本番では開発用のページを読み込まない(静的な import でたどり着かない)", () => {
        // index.js から "import ... from" / "export ... from" だけをたどる(動的な import() はたどらない)
        const reached = new Set<string>();
        const visit = (file: URL) => {
            if (reached.has(file.href)) return;
            reached.add(file.href);
            const source = readFileSync(file, "utf8");
            for (const m of source.matchAll(/^(?:import|export)[^;]*?from\s+"(\.[^"]+)"/gm)) {
                visit(new URL(m[1]!, file));
            }
        };
        visit(new URL(import.meta.resolve("senri")));
        const names = [...reached].map((href) => href.split("/dist/")[1]);

        assert.ok(names.includes("src/app.js"), "たどれていない");
        assert.ok(!names.includes("src/dev/page.generated.js"), "ページの HTML が本番でも読み込まれる");
        assert.ok(!names.includes("src/dev/source.js"), "node:fs を使うコードが本番でも読み込まれる");
    });

    test("ビルド済みのコードでアプリが動く", async () => {
        const { createApp } = await import("senri");
        const app = createApp();
        app.get("/users/:id", ({ id }) => `user ${id}`);

        const res = await app.fetch(new Request("http://localhost/users/42"));

        assert.equal(await res.text(), "user 42");
    });
});
