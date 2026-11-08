import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { type Lang, localePath } from "./i18n";
import { appName, gitConfig } from "./shared";

// ヘッダーの共通の設定(トップ、ドキュメント、ブログ)
export function baseOptions(lang: Lang): BaseLayoutProps {
    return {
        nav: {
            title: <span className="font-mono text-lg font-extrabold tracking-tight">{appName.toLowerCase()}</span>,
            url: localePath(lang, "/"),
        },
        links: [
            { text: lang === "ja" ? "ドキュメント" : "Docs", url: localePath(lang, "/docs"), active: "nested-url" },
            { text: lang === "ja" ? "ブログ" : "Blog", url: localePath(lang, "/blog"), active: "nested-url" },
        ],
        githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    };
}
