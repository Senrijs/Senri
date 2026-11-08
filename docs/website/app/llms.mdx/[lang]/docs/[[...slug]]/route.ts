// ページごとの Markdown(「Markdown でコピー」のボタンが読む)。例: /llms.mdx/ja/docs/routing/content.md
// 静的書き出しでは rewrites が使えないので、/docs/routing.md のような短い URL は作らない
import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { getPageMarkdownUrl } from "@/lib/shared";
import { docsLlms, source } from "@/lib/source";

export const revalidate = false;
export const dynamicParams = false;

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; slug?: string[] }> }) {
    const { lang, slug } = await params;
    // 最後の "content.md" を外す
    const page = source.getPage(slug?.slice(0, -1), lang);
    if (!page) notFound();

    return new Response(await docsLlms.page(page), {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
}

export function generateStaticParams() {
    return i18n.languages.flatMap((lang) =>
        source.getPages(lang).map((page) => ({
            lang,
            slug: getPageMarkdownUrl(page).segments,
        })),
    );
}
