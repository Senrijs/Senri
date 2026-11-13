// <html> と <body>。日本語(app/(ja))と英語(app/(en))の2つのルートのレイアウトから使う
import { JetBrains_Mono, Noto_Sans_JP } from "next/font/google";
// 英字(Geist Sans)。パッケージから読み、このサイトから配る。使う太さのラテン文字だけ
import "@fontsource/geist-sans/latin-400.css";
import "@fontsource/geist-sans/latin-500.css";
import "@fontsource/geist-sans/latin-600.css";
import "@fontsource/geist-sans/latin-700.css";
import "@fontsource/geist-sans/latin-800.css";
import "@fontsource/geist-sans/latin-900.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import type { Lang } from "@/lib/i18n";
import { appName, brand, descriptions, siteUrl } from "@/lib/shared";
import { i18nUI } from "@/lib/translations";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
// 日本語(Noto Sans JP)。ビルドのときに取ってきて、このサイトから配る。英字は Geist Sans(上の @fontsource)
// Noto Sans JP は文字の範囲ごとのファイルに分かれていて、ブラウザは使う範囲のものだけを読む
const jp = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-jp", preload: false });

// 404 ページ(app/global-not-found.tsx)も同じフォントを使う
export const fontVariables = `${mono.variable} ${jp.variable}`;

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
