// <html> と <body>。日本語(app/(ja))と英語(app/(en))の2つのルートのレイアウトから使う
import { JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import type { Lang } from "@/lib/i18n";
import { appName, descriptions, siteUrl } from "@/lib/shared";
import { i18nUI } from "@/lib/translations";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export function rootMetadata(lang: Lang): Metadata {
    return {
        metadataBase: new URL(siteUrl),
        title: { default: appName, template: `%s | ${appName}` },
        description: descriptions[lang],
    };
}

export function Root({ lang, children }: { lang: Lang; children: ReactNode }) {
    return (
        <html lang={lang} className={mono.variable} suppressHydrationWarning>
            <body className="flex min-h-screen flex-col">
                <Provider i18n={i18nUI.provider(lang)}>{children}</Provider>
            </body>
        </html>
    );
}
