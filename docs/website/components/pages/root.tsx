// <html> と <body>。日本語(app/(ja))と英語(app/(en))の2つのルートのレイアウトから使う
import { Inter, JetBrains_Mono, Noto_Sans_JP } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import type { Lang } from "@/lib/i18n";
import { appName, brand, descriptions, siteUrl } from "@/lib/shared";
import { i18nUI } from "@/lib/translations";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
// トップページの見出し(Inter)と本文(Noto Sans JP)。ビルドのときに取ってきて、このサイトから配る
// Noto Sans JP は文字の範囲ごとのファイルに分かれていて、ブラウザは使う範囲のものだけを読む
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jp = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-jp", preload: false });

// 404 ページ(app/global-not-found.tsx)も同じフォントを使う
export const fontVariables = `${mono.variable} ${inter.variable} ${jp.variable}`;

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
