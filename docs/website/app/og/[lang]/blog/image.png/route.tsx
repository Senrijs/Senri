// ブログの一覧の OG 画像。/og/ja/blog/image.png と /og/en/blog/image.png
// 記事ごとの画像は、最初の記事を足すとき(app/(ja)/(home)/blog/_[slug] を [slug] にするとき)に、同じ ogImage で作る
import { notFound } from "next/navigation";
import { gridDict } from "@/lib/home/grid-dict";
import { i18n, type Lang } from "@/lib/i18n";
import { ogImage } from "@/lib/og-card";

export const revalidate = false;
export const dynamicParams = false;

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string }> }) {
    const { lang } = await params;
    if (!(i18n.languages as readonly string[]).includes(lang)) notFound();
    const t = gridDict[lang as Lang];
    return ogImage({ kind: "BLOG", word: "RELEASE", meta: "senri.skyia.jp", title: t.ogBlog, description: t.ogBlogDesc });
}

export function generateStaticParams() {
    return i18n.languages.map((lang) => ({ lang }));
}
