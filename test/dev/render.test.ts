import { describe, expect, test } from "bun:test";
import { DATA_PLACEHOLDER, embedJson, renderPage, wantsHtml } from "../../src/dev/render.ts";

const template = `<!doctype html><html><head><title>Senri</title></head><body><div id="app"></div><script type="application/json" id="senri-data">${DATA_PLACEHOLDER}</script></body></html>`;

// ブラウザと同じように HTML を解析して、script 要素の数と中身を取り出す
async function parse(html: string) {
    const scripts: string[] = [];
    let current: string | null = null;
    await new HTMLRewriter()
        .on("script", {
            element(el) {
                current = "";
                scripts.push("");
                el.onEndTag(() => {
                    scripts[scripts.length - 1] = current!;
                    current = null;
                });
            },
            text(chunk) {
                if (current !== null) current += chunk.text;
            },
        })
        .transform(new Response(html))
        .text();
    return scripts;
}

const attacks = [
    "</script><script>alert(1)</script>",
    "</SCRIPT><img src=x onerror=alert(1)>",
    "<!--<script>",
    "-->",
    String.fromCharCode(0x2028, 0x2029),
    "& &amp; \" '",
    "$& $1 $$ $`",
];

describe("renderPage: エラー情報を安全に埋め込む", () => {
    for (const attack of attacks) {
        test(`メッセージに ${JSON.stringify(attack)} があっても HTML が壊れない`, async () => {
            const data = { message: attack, nested: { list: [attack] } };

            const html = renderPage(template, data);
            const scripts = await parse(html);

            // script 要素は、テンプレートにある1つだけ
            expect(scripts).toHaveLength(1);
            // 中身の JSON を読むと、元のデータに戻る
            expect(JSON.parse(scripts[0]!)).toEqual(data);
        });
    }

    test("埋め込んだ JSON には < > & と U+2028 / U+2029 がそのまま出てこない", () => {
        const json = embedJson({ s: "<>&" + String.fromCharCode(0x2028, 0x2029) });

        expect(json).toBe('{"s":"\\u003c\\u003e\\u0026\\u2028\\u2029"}');
    });

    test("wantsHtml: Accept に text/html があるときだけ。q=0(要らない)は除く", () => {
        const accepts = (accept: string) => wantsHtml(new Request("http://l/", { headers: { accept } }));

        expect(accepts("text/html,application/xhtml+xml,*/*;q=0.8")).toBe(true);
        expect(accepts("text/html;q=0.5")).toBe(true);
        expect(accepts("*/*")).toBe(false);
        expect(accepts("application/json")).toBe(false);
        expect(accepts("text/html;q=0")).toBe(false);
        expect(accepts("text/html; q=0.0, */*")).toBe(false);
        expect(accepts("TEXT/HTML")).toBe(true);
    });

    test("テンプレートに置き場所がなければエラー(作り間違いに気づけるように)", () => {
        expect(() => renderPage("<html></html>", {})).toThrow();
    });
});
