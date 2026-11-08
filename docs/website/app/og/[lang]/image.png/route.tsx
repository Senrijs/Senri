// トップページの OG 画像。/og/ja/image.png と /og/en/image.png
import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";
import { homeDict } from "@/lib/home/dict";
import { i18n, type Lang } from "@/lib/i18n";
import { OgWordmark } from "@/lib/og-brand";
import { ogFonts } from "@/lib/og-fonts";
import { descriptions } from "@/lib/shared";

export const revalidate = false;
export const dynamicParams = false;

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string }> }) {
    const { lang } = await params;
    if (!(i18n.languages as readonly string[]).includes(lang)) notFound();
    const t = homeDict[lang as Lang];
    const title = lang === "ja" ? `${t.h1a}${t.h1b}` : `${t.h1a} ${t.h1b}`;
    const description = descriptions[lang as Lang];
    return generateOGImage({
        title,
        description,
        icon: <OgWordmark />,
        primaryColor: "rgba(227, 65, 43, 0.3)",
        primaryTextColor: "rgb(255, 106, 82)",
        fonts: await ogFonts(`${title}${description}`),
    });
}

export function generateStaticParams() {
    return i18n.languages.map((lang) => ({ lang }));
}
