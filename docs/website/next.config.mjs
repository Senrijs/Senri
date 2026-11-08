import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
    // 静的書き出し(out/)。Cloudflare Workers の静的アセットとして配信する(wrangler.jsonc)
    output: "export",
    // /docs/ を docs/index.html として書き出す(静的なファイルの配信でそのまま開ける)
    trailingSlash: true,
    reactStrictMode: true,
    // Twoslash と fumadocs-typescript が使う TypeScript をバンドルしない
    serverExternalPackages: ["typescript", "twoslash"],
    // リポジトリのルートにも bun.lock があるので、このフォルダーをルートとして扱わせる
    turbopack: { root: import.meta.dirname },
    outputFileTracingRoot: import.meta.dirname,
    experimental: {
        // ルートのレイアウトが言語ごとに2つあるので、404 ページは app/global-not-found.tsx で作る
        globalNotFound: true,
        // motion/react はまとめて書き出すファイル(barrel)なので、使うものだけを取り込ませる
        // (取り込みすぎると、あとで読むはずの domAnimation まで最初に読む JavaScript に入る)
        optimizePackageImports: ["motion"],
    },
};

export default withMDX(config);
