// ブログ(リリースのお知らせ)の一覧と記事。記事はまだない
// トップと同じグリッドの作り(components/top/top.css): 見出しの行、記事ごとの行、最後に伸びる行(縦線をフッターまで通す)
import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { Plus } from "@/components/top/plus";
import { Reveal } from "@/components/top/reveal";
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
        <main id="main">
            <section className="row">
                <div className="box">
                    <Plus />
                    <div className="head blog-head">
                        <Reveal as="h1" className="page-title">
                            {text[lang].title}
                        </Reveal>
                        <p>{text[lang].description}</p>
                    </div>
                </div>
            </section>
            {list.length === 0 ? (
                <div className="row">
                    <div className="box blog-empty">
                        <Plus />
                        <p>{text[lang].empty}</p>
                    </div>
                </div>
            ) : (
                <ol className="blog-list">
                    {list.map((post) => (
                        <li key={post.url} className="row">
                            <div className="box">
                                <Plus />
                                <Link href={post.url} className="blog-post">
                                    <time dateTime={post.data.date.toISOString().slice(0, 10)}>{formatDate(lang, post.data.date)}</time>
                                    <span className="t">{post.data.title}</span>
                                    {post.data.description ? <span className="d">{post.data.description}</span> : null}
                                </Link>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
            <Fill />
        </main>
    );
}

// 中身が短くても、左右の縦線をフッターまで通す(残りの高さを埋める行)
function Fill() {
    return (
        <div className="row fill" aria-hidden="true">
            <div className="box" />
        </div>
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
        <main id="main">
            <section className="row">
                <div className="box">
                    <Plus />
                    <div className="head blog-head">
                        <Reveal as="h1" className="page-title">
                            {page.data.title}
                        </Reveal>
                        <p>
                            {formatDate(lang, page.data.date)}
                            {page.data.author ? ` · ${page.data.author}` : ""}
                        </p>
                    </div>
                </div>
            </section>
            <div className="row">
                <div className="box blog-body">
                    <Plus />
                    <DocsBody>
                        <MDX components={getMDXComponents()} />
                    </DocsBody>
                </div>
            </div>
            <Fill />
        </main>
    );
}
