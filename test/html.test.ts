import { describe, expect, test } from "bun:test";
import { escapeHtml } from "../src/dev/html.ts";

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
