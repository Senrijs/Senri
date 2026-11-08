import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Wordmark } from "@/components/home/wordmark";
import { type Lang, localePath } from "./i18n";
import { githubUrl } from "./shared";

// ドキュメントのヘッダーの設定(トップとブログは components/home/site-shell.tsx)
export function baseOptions(lang: Lang): BaseLayoutProps {
    return {
        nav: {
            title: <Wordmark height={20} />,
            url: localePath(lang, "/"),
        },
        links: [
            { text: lang === "ja" ? "ドキュメント" : "Docs", url: localePath(lang, "/docs"), active: "nested-url" },
            { text: lang === "ja" ? "ブログ" : "Blog", url: localePath(lang, "/blog"), active: "nested-url" },
        ],
        githubUrl,
    };
}
