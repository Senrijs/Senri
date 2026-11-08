import type { Lang } from "./i18n";

export const appName = "Senri";
export const siteUrl = "https://senri.skyia.jp";

export const gitConfig = {
    user: "Senrijs",
    repo: "Senri",
    branch: "main",
};

// ページの Markdown(「Markdown でコピー」と llms.txt)と OG 画像の URL
// 言語の印は、ページの URL と違って /llms.mdx/ja/... のように中に入れる(ルートのファイルを1つにするため)
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
    const segments = [...page.slugs, "content.md"];
    return { segments, url: `/llms.mdx/${page.locale}/docs/${segments.join("/")}` };
}

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
    const segments = [...page.slugs, "image.png"];
    return { segments, url: `/og/${page.locale}/docs/${segments.join("/")}` };
}

export const descriptions: Record<Lang, string> = {
    ja: "Web 標準で作った小さな Web フレームワーク。Bun、Deno、Node.js、Cloudflare Workers、ブラウザで動きます。",
    en: "A small web framework built on Web standards. Runs on Bun, Deno, Node.js, Cloudflare Workers and browsers.",
};
