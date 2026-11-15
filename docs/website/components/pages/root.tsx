// <html> と <body>。日本語(app/(ja))と英語(app/(en))の2つのルートのレイアウトから使う
import { JetBrains_Mono, Noto_Sans_JP } from "next/font/google";
import localFont from "next/font/local";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import type { Lang } from "@/lib/i18n";
import { appName, brand, descriptions, siteUrl } from "@/lib/shared";
import { i18nUI } from "@/lib/translations";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
// 日本語(Noto Sans JP)。ビルドのときに取ってきて、このサイトから配る。英字は Geist Sans(下)
// Noto Sans JP は文字の範囲ごとのファイルに分かれていて、ブラウザは使う範囲のものだけを読む
const jp = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-jp", preload: false });

// 英字(Geist Sans)。@fontsource/geist-sans のファイルを読み、このサイトから配る。使う太さのラテン文字だけ
// unicode-range をラテン文字に絞る(Geist は「。」「」などの約物も持っていて、そのままだと日本語の約物まで Geist で出て詰まる)
// next/font の設定は、そのまま書いた値でないといけない(変数や map は使えない)
const geist = localFont({
    src: [
        { path: "../../node_modules/@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
        { path: "../../node_modules/@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
        { path: "../../node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
        { path: "../../node_modules/@fontsource/geist-sans/files/geist-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
        { path: "../../node_modules/@fontsource/geist-sans/files/geist-sans-latin-800-normal.woff2", weight: "800", style: "normal" },
        { path: "../../node_modules/@fontsource/geist-sans/files/geist-sans-latin-900-normal.woff2", weight: "900", style: "normal" },
    ],
    variable: "--font-geist",
    declarations: [
        {
            prop: "unicode-range",
            value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
        },
    ],
    preload: false,
});

// 404 ページ(app/global-not-found.tsx)も同じフォントを使う
export const fontVariables = `${mono.variable} ${jp.variable} ${geist.variable}`;

export function rootMetadata(lang: Lang): Metadata {
    return {
        metadataBase: new URL(siteUrl),
        title: { default: appName, template: `%s | ${appName}` },
        description: descriptions[lang],
        icons: { icon: { url: brand.icon, type: "image/svg+xml" } },
    };
}

export function Root({ lang, children }: { lang: Lang; children: ReactNode }) {
    return (
        <html lang={lang} className={fontVariables} suppressHydrationWarning>
            <body className="flex min-h-screen flex-col">
                <Provider i18n={i18nUI.provider(lang)}>{children}</Provider>
            </body>
        </html>
    );
}
