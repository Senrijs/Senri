// 404 ページ(out/404.html)。ルートのレイアウトが言語ごとに2つあるので、どちらにも属さない global-not-found を使う
// 1つの 404.html がどの URL にも返るので、言語と「もしかして」はブラウザで決める(components/home/not-found.tsx)
// 「もしかして」の候補として、全部のページの URL を埋め込む(日英で 70 件ほど、数 KB)
import type { Metadata } from "next";
import { NotFoundRoot } from "@/components/home/not-found-root";
import { fontVariables } from "@/components/pages/root";
import { i18n, type Lang, localePath } from "@/lib/i18n";
import { brand } from "@/lib/shared";
import type { Candidate } from "@/lib/suggest";
import { blogSource, source } from "@/lib/source";
import { i18nUI } from "@/lib/translations";
import "@/app/global.css";
import "@/components/home/not-found.css";

export const metadata: Metadata = {
    title: "404 Not Found | Senri",
    robots: { index: false },
    icons: { icon: { url: brand.icon, type: "image/svg+xml" } },
};

// [比べるパス, 勧めるページ] の組。章のフォルダー(/docs/routing/)は、その章の最初のページを勧める
// 目次(ページの木)の順にページの URL を並べる(章の「最初のページ」を、目次のとおりにするため)
type TreeNode = { type: string; url?: string; children?: TreeNode[]; index?: { url: string } };
function inOrder(nodes: TreeNode[], out: string[] = []): string[] {
    for (const node of nodes) {
        if (node.type === "page" && node.url) out.push(`${node.url}/`);
        if (node.type === "folder") {
            if (node.index) out.push(`${node.index.url}/`);
            inOrder(node.children ?? [], out);
        }
    }
    return out;
}

function candidates(lang: Lang): Candidate[] {
    const all = source.getPages(lang).map((page) => `${page.url}/`);
    const ordered = inOrder((source.getPageTree(lang) as unknown as { children: TreeNode[] }).children);
    const pages = [...new Set([...ordered.filter((url) => all.includes(url)), ...all])];
    const list: Candidate[] = [localePath(lang, "/"), localePath(lang, "/docs/"), localePath(lang, "/blog/"), ...pages, ...blogSource.getPages(lang).map((page) => `${page.url}/`)].map(
        (url) => [url, url],
    );
    const folders = new Map<string, string>();
    for (const url of pages) {
        const folder = url.replace(/[^/]+\/$/, "");
        if (!folders.has(folder)) folders.set(folder, url);
    }
    for (const [folder, first] of folders) if (!pages.includes(folder)) list.push([folder, first]);
    return list;
}

export default function GlobalNotFound() {
    const langs = i18n.languages as readonly Lang[];
    const providers = Object.fromEntries(langs.map((lang) => [lang, i18nUI.provider(lang)])) as Record<Lang, ReturnType<typeof i18nUI.provider>>;
    const list = Object.fromEntries(langs.map((lang) => [lang, candidates(lang)])) as Record<Lang, Candidate[]>;
    return (
        <html lang="ja" className={fontVariables} suppressHydrationWarning>
            <body className="flex min-h-screen flex-col">
                <NotFoundRoot providers={providers} candidates={list} />
            </body>
        </html>
    );
}
