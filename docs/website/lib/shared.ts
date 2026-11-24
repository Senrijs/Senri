import type { Lang } from "./i18n";

export const appName = "Senri";
export const siteUrl = "https://senri.skyia.jp";

export const gitConfig = {
    user: "Senrijs",
    repo: "Senri",
    branch: "main",
};

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

// ロゴ。https://github.com/Senrijs/brand(d9f075d)の SVG を public/brand/ にコピーしたもの
export const brand = {
    wordmarkLight: "/brand/senri-wordmark-light.svg",
    wordmarkDark: "/brand/senri-wordmark-dark.svg",
    icon: "/brand/senri-icon-accent.svg",
};

// ページの Markdown(「Markdown でコピー」と llms.txt)と OG 画像の URL
// 言語の印は、ページの URL と違って /llms.mdx/ja/... のように中に入れる(ルートのファイルを1つにするため)
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
    const segments = [...page.slugs, "content.md"];
    return { segments, url: `/llms.mdx/${page.locale}/docs/${segments.join("/")}` };
}

// og:image と twitter:image に付ける版(?v=...)。値は next.config.mjs の ogVersion で決める
// Discord などは同じ URL の画像を覚えていて、中身を新しくしても古いまま出すので、ビルドごとに URL を変える
// 画像そのものの URL は変えない(静的なファイルの配信はクエリを見ないので、?v= が付いても同じ画像が返る)
export function withOgVersion(url: string) {
    const version = process.env.OG_VERSION;
    return version ? `${url}?v=${version}` : url;
}

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
    const segments = [...page.slugs, "image.png"];
    return { segments, url: `/og/${page.locale}/docs/${segments.join("/")}` };
}

export const descriptions: Record<Lang, string> = {
    ja: "Web 標準で作った小さな Web フレームワーク。Bun、Deno、Node.js、Cloudflare Workers、ブラウザで動きます。",
    en: "A small web framework built on Web standards. Runs on Bun, Deno, Node.js, Cloudflare Workers and browsers.",
};
