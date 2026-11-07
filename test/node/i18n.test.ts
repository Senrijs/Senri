// 開発用の文言の切り替えを、Node のアダプターで確かめる
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { terminalLang } from "../../src/lang.ts";
import { closeServers, listen, raw, request } from "./http.ts";

after(closeServers);

// raw() は latin1 で読む
const utf8 = async (text: Promise<string>) => Buffer.from(await text, "latin1").toString("utf8");

function boomApp(lang?: "ja" | "en") {
    const app = createApp({ dev: devtools(lang ? { lang } : {}) });
    app.get("/hello", () => "hi");
    app.get("/boom", () => {
        throw new Error("x");
    });
    return app;
}

describe("開発用の文言と Node", () => {
    test("テキストの 404 は Accept-Language で切り替わる。ないときと知らない言語は英語", async () => {
        const port = await listen(boomApp());

        assert.match(await utf8(raw(port, request("GET", "/helo", { "accept-language": "ja" }))), /もしかして: GET \/hello \?/);
        assert.match(await raw(port, request("GET", "/helo", { "accept-language": "en" })), /Did you mean: GET \/hello \?/);
        assert.match(await raw(port, request("GET", "/helo")), /Did you mean: GET \/hello \?/);
        assert.match(await raw(port, request("GET", "/helo", { "accept-language": "fr" })), /Did you mean: GET \/hello \?/);
    });

    test("エラーページの言語が切り替わる。Vary を付ける", async () => {
        const port = await listen(boomApp());
        const page = (language: string) => raw(port, request("GET", "/boom", { accept: "text/html", "accept-language": language }));

        const ja = await page("ja-JP");
        assert.match(ja, /<html lang="ja">/);
        assert.match(ja, /vary: Accept-Language/i);
        assert.match(await page("en-US"), /<html lang="en">/);
    });

    test("devtools({ lang }) は Accept-Language より優先する", async () => {
        const port = await listen(boomApp("ja"));

        const text = await utf8(raw(port, request("GET", "/helo", { "accept-language": "en" })));
        assert.match(text, /もしかして/);
        assert.doesNotMatch(text, /vary:/i);
    });

    test("ターミナルの言語は OS のロケールまで見る", () => {
        const none = () => undefined;

        assert.equal(terminalLang(none, () => "ja-JP"), "ja");
        assert.equal(terminalLang((name) => (name === "LANG" ? "ja_JP.UTF-8" : undefined), () => "en-US"), "ja");
        assert.equal(terminalLang((name) => (name === "LANG" ? "C" : undefined), () => "ja-JP"), "en");
    });
});
