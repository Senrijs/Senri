// 404 ページ(out/404.html)。ルートのレイアウトが言語ごとに2つあるので、どちらにも属さない global-not-found を使う
// どの言語の URL で来たかは静的書き出しでは分からないので、日本語と英語を両方書く
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { Metadata } from "next";
import Link from "next/link";
import { Provider } from "@/components/provider";
import { baseOptions } from "@/lib/layout.shared";
import { i18nUI } from "@/lib/translations";
import "@/app/global.css";

export const metadata: Metadata = {
    title: "404 Not Found | Senri",
};

export default function GlobalNotFound() {
    return (
        <html lang="ja" suppressHydrationWarning>
            <body className="flex min-h-screen flex-col">
                <Provider i18n={i18nUI.provider("ja")}>
                    <HomeLayout {...baseOptions("ja")}>
                        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
                            <p className="font-mono text-sm text-fd-muted-foreground">404 Not Found</p>
                            <h1 className="text-2xl font-bold">ページが見つかりませんでした</h1>
                            <p className="text-fd-muted-foreground">The page could not be found.</p>
                            <div className="mt-2 flex gap-4">
                                <Link href="/" className="font-medium text-fd-primary underline">
                                    トップへ
                                </Link>
                                <Link href="/en" className="font-medium text-fd-primary underline">
                                    English
                                </Link>
                            </div>
                        </main>
                    </HomeLayout>
                </Provider>
            </body>
        </html>
    );
}
