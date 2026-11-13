// トップページとブログの外側(app/(ja)/(home) と app/(en)/en/(home) から使う)。中身は components/top(グリッド版)
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GridShell } from "@/components/top/shell";
import { TopPage } from "@/components/top/top-page";
import { gridDict } from "@/lib/home/grid-dict";
import type { Lang } from "@/lib/i18n";
import { appName, descriptions } from "@/lib/shared";

export function HomeShell({ lang, children }: { lang: Lang; children: ReactNode }) {
    return <GridShell lang={lang}>{children}</GridShell>;
}

export function HomePage({ lang }: { lang: Lang }) {
    return <TopPage lang={lang} />;
}

export function homeMetadata(lang: Lang): Metadata {
    const t = gridDict[lang];
    const title = `${appName} — ${t.h1.join(lang === "ja" ? "" : " ")}`;
    const image = `/og/${lang}/image.png`;
    return {
        title: { absolute: title },
        description: descriptions[lang],
        openGraph: { title, description: descriptions[lang], images: image },
        twitter: { card: "summary_large_image", title, description: descriptions[lang], images: image },
    };
}
