import { describe, expect, test } from "bun:test";
import { PAGE_HTML } from "../../src/dev/page.generated.ts";
import { DATA_PLACEHOLDER, renderPage } from "../../src/dev/render.ts";

describe("ビルド済みのページ(page.generated.ts)", () => {
    test("データの置き場所がちょうど1つある", () => {
        expect(PAGE_HTML.split(DATA_PLACEHOLDER)).toHaveLength(2);
    });

    test("1枚にまとまっていて、外のスクリプトやスタイルを読みにいかない", () => {
        expect(PAGE_HTML).not.toMatch(/<script[^>]+src=/);
        expect(PAGE_HTML).not.toMatch(/<link[^>]+href="\.?\/(?!\/)/);
    });

    test("Vue のアプリが入っている", () => {
        expect(PAGE_HTML).toContain('<div id="app">');
        expect(PAGE_HTML).toMatch(/<script type="module"[^>]*>[\s\S]+createApp|<script type="module"[^>]*>[\s\S]{1000,}/);
    });

    test("データを埋め込める", () => {
        const html = renderPage(PAGE_HTML, { kind: "notFound", method: "GET", path: "/x", suggestion: null, routes: [] });

        expect(html).toContain('"path":"/x"');
        expect(html).not.toContain(DATA_PLACEHOLDER);
    });
});
