// ページごとの OG 画像。例: /og/ja/docs/routing/image.png
// 静的書き出しでも、ビルドのときに PNG のファイルとして書き出される
import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { ogFonts } from "@/lib/og-fonts";
import { appName, getPageImageUrl } from "@/lib/shared";
import { source } from "@/lib/source";

export const revalidate = false;
export const dynamicParams = false;

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; slug: string[] }> }) {
    const { lang, slug } = await params;
    // 最後の "image.png" を外す
    const page = source.getPage(slug.slice(0, -1), lang);
    if (!page) notFound();

    const title = page.data.title;
    const description = page.data.description ?? "";
    return generateOGImage({
        title,
        description,
        site: appName,
        primaryColor: "rgba(227, 65, 43, 0.3)",
        primaryTextColor: "rgb(255, 106, 82)",
        // 日本語の字形を持つフォントを渡す(Satori は woff2 を読めないので woff)
        fonts: await ogFonts(`${title}${description}${appName}`),
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
