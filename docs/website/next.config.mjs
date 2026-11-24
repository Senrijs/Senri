import { execFileSync } from "node:child_process";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// OG 画像の URL に付ける版(lib/shared.ts の withOgVersion)。ビルドごとに変わる値を、上から順に使う
// 1. WORKERS_CI_COMMIT_SHA: Cloudflare Workers Builds が入れるコミットのハッシュ(先頭 7 文字)
// 2. git rev-parse --short HEAD: 手元のビルドなど、git が使えるとき
// 3. ビルドした時刻: どちらも取れないとき(同じコミットでもビルドのたびに変わる)
// process.env に入れておくのは、next build が分けて動かすプロセスでも同じ値を使うため
function ogVersion() {
    const sha = process.env.WORKERS_CI_COMMIT_SHA?.trim();
    if (sha) return sha.slice(0, 7);
    try {
        const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (head) return head;
    } catch {}
    return Date.now().toString(36);
}
process.env.OG_VERSION ||= ogVersion();

/** @type {import('next').NextConfig} */
const config = {
    // 静的書き出し(out/)。Cloudflare Workers の静的アセットとして配信する(wrangler.jsonc)
    output: "export",
    // /docs/ を docs/index.html として書き出す(静的なファイルの配信でそのまま開ける)
    trailingSlash: true,
    reactStrictMode: true,
    // ビルドのときに埋め込む(上の ogVersion の値)
    env: { OG_VERSION: process.env.OG_VERSION },
    // Twoslash と fumadocs-typescript が使う TypeScript をバンドルしない
    serverExternalPackages: ["typescript", "twoslash"],
    // リポジトリのルートにも bun.lock があるので、このフォルダーをルートとして扱わせる
    turbopack: { root: import.meta.dirname },
    outputFileTracingRoot: import.meta.dirname,
    experimental: {
        // ルートのレイアウトが言語ごとに2つあるので、404 ページは app/global-not-found.tsx で作る
        globalNotFound: true,
    },
};

export default withMDX(config);
