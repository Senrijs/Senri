// 記事のページ。Next.js の静的書き出しは、記事が 0 件だと [slug] のルートでビルドが止まる。
// なので記事がないうちは、ルートにならない _[slug] というフォルダーに置いている。最初の記事を足すときに [slug] に名前を変える
import { BlogPost, blogParams, blogPostMetadata } from "@/components/pages/blog";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export default async function Page({ params }: Props) {
    return <BlogPost lang="ja" slug={(await params).slug} />;
}

export function generateStaticParams() {
    return blogParams("ja");
}

export async function generateMetadata({ params }: Props) {
    return blogPostMetadata("ja", (await params).slug);
}
