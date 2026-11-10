// パッケージとして使われたときの形を確かめる(bun run build のあとに動かす)
// "@senrijs/senri" はパッケージの自己参照なので、package.json の exports がそのまま使われる
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("パッケージ", () => {
    test('"@senrijs/senri" はビルド済みの dist/ の .js を指す', () => {
        // node_modules に入ったとき、Node は .ts の型を外してくれないので .js でないといけない
        assert.match(import.meta.resolve("@senrijs/senri"), /\/dist\/src\/index\.js$/);
    });

    test('"@senrijs/senri/streaming" でストリーミングのヘルパーが使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/streaming"), /\/dist\/src\/streaming\.js$/);
        const { stream, streamSSE, streamText } = await import("@senrijs/senri/streaming");

        assert.deepEqual([typeof stream, typeof streamText, typeof streamSSE], ["function", "function", "function"]);
    });

    test('"@senrijs/senri/problem" で Problem Details が使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/problem"), /\/dist\/src\/problem\.js$/);
        const { problem, problemDetails, ProblemError } = await import("@senrijs/senri/problem");

        assert.deepEqual([typeof problem, typeof problemDetails, typeof ProblemError], ["function", "function", "function"]);
    });

    test('"@senrijs/senri/jwt" で JWT が使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/jwt"), /\/dist\/src\/jwt\.js$/);
        const { jwt, signJwt, verifyJwt, JwtError } = await import("@senrijs/senri/jwt");

        assert.deepEqual([typeof jwt, typeof signJwt, typeof verifyJwt, typeof JwtError], ["function", "function", "function", "function"]);
    });

    test('"@senrijs/senri/context-storage" で Context Storage が使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/context-storage"), /\/dist\/adapters\/context-storage\/index\.js$/);
        const { contextStorage, getContext, tryGetContext } = await import("@senrijs/senri/context-storage");

        assert.deepEqual([typeof contextStorage, typeof getContext, typeof tryGetContext], ["function", "function", "function"]);
    });

    test('"@senrijs/senri/client" で型付きクライアントが使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/client"), /\/dist\/src\/client\.js$/);
        const { client } = await import("@senrijs/senri/client");

        assert.equal(typeof client, "function");
    });

    test('"@senrijs/senri/testing" でテスト用ヘルパーが使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/testing"), /\/dist\/src\/testing\.js$/);
        const { testClient, request } = await import("@senrijs/senri/testing");

        assert.deepEqual([typeof testClient, typeof request], ["function", "function"]);
    });

    test('"@senrijs/senri/websocket" で WebSocket が使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/websocket"), /\/dist\/src\/websocket\.js$/);
        const { upgradeWebSocket, websocket } = await import("@senrijs/senri/websocket");

        assert.deepEqual([typeof upgradeWebSocket, typeof websocket.open], ["function", "function"]);
    });

    test('"@senrijs/senri/openapi" で OpenAPI の文書を作れる', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/openapi"), /\/dist\/src\/openapi\.js$/);
        const { openAPI } = await import("@senrijs/senri/openapi");

        assert.equal(typeof openAPI, "function");
    });

    test('"@senrijs/senri/otel" で OpenTelemetry が使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/otel"), /\/dist\/src\/otel\.js$/);
        const { otel } = await import("@senrijs/senri/otel");

        assert.equal(typeof otel, "function");
    });

    test('"@senrijs/senri/node" で Node アダプターが使える', async () => {
        assert.match(import.meta.resolve("@senrijs/senri/node"), /\/dist\/adapters\/node\/index\.js$/);
        const { serve } = await import("@senrijs/senri/node");

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
        visit(new URL(import.meta.resolve("@senrijs/senri")));
        const names = [...reached].map((href) => href.split("/dist/")[1]);

        assert.ok(names.includes("src/app.js"), "たどれていない");
        assert.ok(!names.includes("src/dev/page.generated.js"), "ページの HTML が本番でも読み込まれる");
        assert.ok(!names.includes("src/dev/source.js"), "node:fs を使うコードが本番でも読み込まれる");
    });

    test("ビルド済みのコードでアプリが動く", async () => {
        const { createApp } = await import("@senrijs/senri");
        const app = createApp();
        app.get("/users/:id", ({ id }) => `user ${id}`);

        const res = await app.fetch(new Request("http://localhost/users/42"));

        assert.equal(await res.text(), "user 42");
    });
});
