// ui/ をビルドした1枚の HTML を、Senri に同梱する TS モジュール(src/dev/page.generated.ts)にする
// 使い方: bun run build:pages(vite build のあとにこれが動く)
import { readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER = "<!--senri:data-->";
const FALLBACK_PLACEHOLDER = "<!--senri:fallback-->";
const input = new URL("../ui/dist/index.html", import.meta.url);
const output = new URL("../src/dev/page.generated.ts", import.meta.url);

// 改行は LF にそろえる。Windows では git がチェックアウト時に ui/index.html を CRLF にすることがあり、
// そのままだと生成物の中身が「誰のどの PC でビルドしたか」で変わってしまう(CI の差分チェックが落ちる)
const html = readFileSync(input, "utf8").replace(/\r\n?/g, "\n");

// 1枚にまとまっているか(外のファイルを読みにいっていないか)を確かめる
if (/<script[^>]+src=/.test(html) || /<link[^>]+rel="stylesheet"[^>]+href="\.?\//.test(html)) {
    throw new Error("ビルド結果が外のファイルを読み込んでいます。vite-plugin-singlefile が効いていません");
}
for (const placeholder of [PLACEHOLDER, FALLBACK_PLACEHOLDER]) {
    if (html.split(placeholder).length !== 2) {
        throw new Error(`ビルド結果に ${placeholder} がちょうど1つありません`);
    }
}

const source = [
    "// このファイルは scripts/build-pages.ts が作る。手で書き換えないこと(bun run build:pages で作り直す)",
    "// 中身は ui/ を Vue + Vite でビルドした1枚の HTML。利用者には Vue も Vite も入らない",
    `export const PAGE_HTML: string = ${JSON.stringify(html)};`,
    "",
].join("\n");

writeFileSync(output, source);
console.log(`src/dev/page.generated.ts を書き出しました(${(Buffer.byteLength(source) / 1024).toFixed(1)} KB)`);
