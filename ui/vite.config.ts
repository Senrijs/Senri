// 開発モードのエラーページ / 404ページを、1枚の HTML にビルドする
// - bun run build:pages で ui/dist/index.html を作り、src/dev/page.generated.ts に文字列として書き出す
// - npx vite --config ui/vite.config.ts で、サンプルデータを使って見た目を確かめられる
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

// Vite が index.html を処理する前に、改行を LF にそろえる
// (CRLF のままだと、Vite が <script src> の行を取り除いたあとに空行が1つ残り、
//  ビルド結果が「どの改行コードでチェックアウトしたか」で変わってしまう)
const normalizeLineEndings = {
    name: "senri:normalize-line-endings",
    transformIndexHtml: {
        order: "pre" as const,
        handler: (html: string) => html.replace(/\r\n?/g, "\n"),
    },
};

export default defineConfig({
    root: import.meta.dirname,
    plugins: [normalizeLineEndings, vue(), viteSingleFile()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // 小さい画像なども全部 HTML に埋め込む
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    },
});
