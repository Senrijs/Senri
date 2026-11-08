// トップページとブログの外側(app/(ja)/(home) と app/(en)/en/(home) から使う)
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HomePage as Page } from "@/components/home/home-page";
import { SiteShell } from "@/components/home/site-shell";
import { homeDict } from "@/lib/home/dict";
import type { Lang } from "@/lib/i18n";
import { appName, descriptions } from "@/lib/shared";

export function HomeShell({ lang, children }: { lang: Lang; children: ReactNode }) {
    return <SiteShell lang={lang}>{children}</SiteShell>;
}

export function HomePage({ lang }: { lang: Lang }) {
    return <Page lang={lang} />;
}

export function homeMetadata(lang: Lang): Metadata {
    const t = homeDict[lang];
    const title = `${appName} — ${t.h1a}${lang === "ja" ? "" : " "}${t.h1b}`;
    const image = `/og/${lang}/image.png`;
    return {
        title: { absolute: title },
        description: descriptions[lang],
        openGraph: { title, description: descriptions[lang], images: image },
        twitter: { card: "summary_large_image", title, description: descriptions[lang], images: image },
    };
}
