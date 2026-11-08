// 言語の設定。日本語は言語の印なし(/、/docs)、英語は /en、/en/docs
// 静的書き出し(output: "export")では middleware が動かないので、Fumadocs の createI18nMiddleware は使わない。
// 代わりに app/(ja) と app/(en)/en に、言語ごとのルートのファイルを置いている(中身は components/pages の共通の部品)
import { defineI18n } from "fumadocs-core/i18n";

export const i18n = defineI18n({
    defaultLanguage: "ja",
    languages: ["ja", "en"],
    hideLocale: "default-locale",
    // content/docs/ja/*.mdx と content/docs/en/*.mdx
    parser: "dir",
});

export type Lang = (typeof i18n.languages)[number];

// /docs → /docs(日本語)、/en/docs(英語)
export function localePath(lang: Lang, path: string): string {
    return lang === i18n.defaultLanguage ? path : `/${lang}${path === "/" ? "" : path}`;
}
