// トップページの OG 画像。/og/ja/image.png と /og/en/image.png
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
    return ogImage({ kind: "TOP", word: "SENRI", meta: "senri.skyia.jp", title: t.h1, description: t.ogTopDesc });
}

export function generateStaticParams() {
    return i18n.languages.map((lang) => ({ lang }));
}
