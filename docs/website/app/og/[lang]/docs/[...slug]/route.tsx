// ページごとの OG 画像。例: /og/ja/docs/routing/routes/image.png
// 静的書き出しでも、ビルドのときに PNG のファイルとして書き出される
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { gridDict } from "@/lib/home/grid-dict";
import { i18n, type Lang } from "@/lib/i18n";
import { ogImage } from "@/lib/og-card";
import { getPageImageUrl } from "@/lib/shared";
import { source } from "@/lib/source";

export const revalidate = false;
export const dynamicParams = false;

// 章の名前(content/docs/<lang>/meta.json の ---基本--- のような区切り)を、最初のフォルダーごとに引く
const sections = new Map<string, Map<string, string>>();
function sectionOf(lang: string, first: string): string | null {
    let map = sections.get(lang);
    if (!map) {
        map = new Map();
        const meta = JSON.parse(readFileSync(join(process.cwd(), "content", "docs", lang, "meta.json"), "utf8")) as { pages: string[] };
        let current: string | null = null;
        for (const entry of meta.pages) {
            const sep = /^---(.+)---$/.exec(entry);
            if (sep) current = sep[1]!;
            else if (current) map.set(entry.replace(/^\.\.\./, ""), current);
        }
        sections.set(lang, map);
    }
    return map.get(first) ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; slug: string[] }> }) {
    const { lang, slug } = await params;
    // 最後の "image.png" を外す
    const slugs = slug.slice(0, -1);
    const page = source.getPage(slugs, lang);
    if (!page) notFound();

    const t = gridDict[lang as Lang];
    const first = slugs[0] ?? "index";
    const section = sectionOf(lang, first);
    return ogImage({
        kind: "DOCS",
        // 後ろの大きな英単語は、最初のフォルダーの名前(トップは DOCS)
        word: slugs.length === 0 ? "DOCS" : first.replace(/-/g, " ").toUpperCase(),
        meta: section ? `${t.ogDocs} / ${section}` : t.ogDocs,
        title: page.data.title,
        description: page.data.description ?? "",
    });
}

export function generateStaticParams() {
    return i18n.languages.flatMap((lang) =>
        source.getPages(lang).map((page) => ({
            lang,
            slug: getPageImageUrl(page).segments,
        })),
    );
}
