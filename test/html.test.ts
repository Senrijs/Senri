import { describe, expect, test } from "bun:test";
import { escapeHtml } from "../src/dev/html.ts";
import { createApp } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { PAGE_HTML } from "../src/dev/page.generated.ts";

describe("escapeHtml", () => {
    test("HTML として意味を持つ5文字をエスケープする", () => {
        expect(escapeHtml(`<script>alert("x" + 'y')</script> & more`)).toBe(
            "&lt;script&gt;alert(&quot;x&quot; + &#39;y&#39;)&lt;/script&gt; &amp; more",
        );
    });

    test("エスケープ済みに見える文字列も、文字どおりに表示されるようエスケープする", () => {
        expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });

    test("日本語やふつうの文字はそのまま", () => {
        expect(escapeHtml("/users/山田?q=1")).toBe("/users/山田?q=1");
    });

    test("文字列以外(エラーの message が数値だった場合など)も文字列にしてから処理する", () => {
        expect(escapeHtml(123)).toBe("123");
        expect(escapeHtml(undefined)).toBe("undefined");
    });
});

// 開発用のページは、開くたびに外へ通信しない(オフラインでも遅れずに出る。どこを開いたかを外に知らせない)
describe("開発用のページが外のものを読み込まない", () => {
    // http(s) の URL として残してよいもの。どれも Vue のランタイムの中の文字列で、読み込むものではない
    // - XML の名前空間の名前(SVG / xlink / MathML の要素を作るときに使う)
    // - Vue のエラーの説明の参照先(エラーの文言に入るだけ)
    const ALLOWED = [
        "http://www.w3.org/2000/svg",
        "http://www.w3.org/1999/xlink",
        "http://www.w3.org/1998/Math/MathML",
        "https://vuejs.org/error-reference/",
    ];
    // 外のものを読み込む書き方: src / href 属性、CSS の url() と @import
    const LOADS = /(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import/i;

    test("ページの HTML にある URL は、決めたものだけ", () => {
        const urls = PAGE_HTML.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
        const unexpected = urls.filter((url) => !ALLOWED.some((allowed) => url.startsWith(allowed)));
        expect(unexpected).toEqual([]);
        expect(PAGE_HTML).not.toMatch(LOADS);
    });

    test("エラーページ・404 ページ・ダッシュボードのレスポンスも、外のものを読み込まない", async () => {
        const app = createApp({ dev: devtools() });
        app.get("/boom", () => {
            throw new Error("boom");
        });
        const html = { headers: { accept: "text/html" } };
        const loopback = { remoteAddr: { hostname: "127.0.0.1" } };
        const pages = [
            await app.fetch(new Request("http://localhost/boom", html)),
            await app.fetch(new Request("http://localhost/nope", html)),
            await app.fetch(new Request("http://localhost/_senri", html), loopback),
        ];
        for (const res of pages) {
            expect(res.headers.get("content-type")).toContain("text/html");
            expect(await res.text()).not.toMatch(LOADS);
        }
    });
});
