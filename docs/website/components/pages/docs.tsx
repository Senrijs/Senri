// ドキュメントのレイアウトとページ。日本語と英語のルートのファイルから、lang を渡して使う
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle, MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getMDXComponents } from "@/components/mdx";
import type { Lang } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";
import { getPageImageUrl, getPageMarkdownUrl, gitConfig } from "@/lib/shared";
import { source } from "@/lib/source";

export function DocsShell({ lang, children }: { lang: Lang; children: ReactNode }) {
    return (
        <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
            {children}
        </DocsLayout>
    );
}

export function DocsContent({ lang, slug }: { lang: Lang; slug?: string[] }) {
    const page = source.getPage(slug, lang);
    if (!page) notFound();

    const MDX = page.data.body;
    const markdownUrl = getPageMarkdownUrl(page).url;

    return (
        <DocsPage toc={page.data.toc} full={page.data.full}>
            <DocsTitle>{page.data.title}</DocsTitle>
            <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
            <div className="flex flex-row items-center gap-2 border-b pb-6">
                <MarkdownCopyButton markdownUrl={markdownUrl} />
                <ViewOptionsPopover
                    markdownUrl={markdownUrl}
                    githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/docs/website/content/docs/${page.path}`}
                />
            </div>
            <DocsBody>
                <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
            </DocsBody>
        </DocsPage>
    );
}

export function docsParams(lang: Lang) {
    return source.getPages(lang).map((page) => ({ slug: page.slugs }));
}

export function docsMetadata(lang: Lang, slug?: string[]): Metadata {
    const page = source.getPage(slug, lang);
    if (!page) notFound();
    const image = getPageImageUrl(page).url;
    return {
        title: page.data.title,
        description: page.data.description,
        openGraph: { images: image },
        twitter: { card: "summary_large_image", images: image },
    };
}
