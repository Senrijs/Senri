// ブログ(リリースのお知らせ)の一覧と記事。記事はまだない
import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Lang } from "@/lib/i18n";
import { blogSource } from "@/lib/source";

const text = {
    ja: { title: "ブログ", description: "リリースのお知らせなど", empty: "まだ記事はありません。" },
    en: { title: "Blog", description: "Release announcements and more", empty: "No posts yet." },
};

function posts(lang: Lang) {
    return blogSource.getPages(lang).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

const formatDate = (lang: Lang, date: Date) =>
    date.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export function blogIndexMetadata(lang: Lang): Metadata {
    const image = `/og/${lang}/blog/image.png`;
    return {
        title: text[lang].title,
        description: text[lang].description,
        openGraph: { images: image },
        twitter: { card: "summary_large_image", images: image },
    };
}

export function BlogIndex({ lang }: { lang: Lang }) {
    const list = posts(lang);
    return (
        <main id="main" className="mx-auto w-full max-w-3xl px-4 py-12">
            <h1 className="mb-2 text-3xl font-bold">{text[lang].title}</h1>
            <p className="mb-8 text-fd-muted-foreground">{text[lang].description}</p>
            {list.length === 0 ? (
                <p>{text[lang].empty}</p>
            ) : (
                <ul className="flex flex-col gap-6">
                    {list.map((post) => (
                        <li key={post.url}>
                            <Link href={post.url} className="text-xl font-semibold hover:underline">
                                {post.data.title}
                            </Link>
                            <p className="text-sm text-fd-muted-foreground">{formatDate(lang, post.data.date)}</p>
                            {post.data.description ? <p className="mt-1">{post.data.description}</p> : null}
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}

export function blogParams(lang: Lang) {
    return blogSource.getPages(lang).map((page) => ({ slug: page.slugs[0]! }));
}

export function blogPostMetadata(lang: Lang, slug: string): Metadata {
    const page = blogSource.getPage([slug], lang);
    if (!page) notFound();
    return { title: page.data.title, description: page.data.description };
}

export function BlogPost({ lang, slug }: { lang: Lang; slug: string }) {
    const page = blogSource.getPage([slug], lang);
    if (!page) notFound();
    const MDX = page.data.body;
    return (
        <main id="main" className="mx-auto w-full max-w-3xl px-4 py-12">
            <h1 className="mb-2 text-3xl font-bold">{page.data.title}</h1>
            <p className="mb-8 text-sm text-fd-muted-foreground">
                {formatDate(lang, page.data.date)}
                {page.data.author ? ` · ${page.data.author}` : ""}
            </p>
            <DocsBody>
                <MDX components={getMDXComponents()} />
            </DocsBody>
        </main>
    );
}
