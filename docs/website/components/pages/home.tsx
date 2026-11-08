// トップページ(仮)。デザインはあとの PR で作る
import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { type Lang, localePath } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";
import { appName, descriptions } from "@/lib/shared";

export function HomeShell({ lang, children }: { lang: Lang; children: ReactNode }) {
    return <HomeLayout {...baseOptions(lang)}>{children}</HomeLayout>;
}

export function HomePage({ lang }: { lang: Lang }) {
    return (
        <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
            <h1 className="font-mono text-4xl font-extrabold tracking-tight">{appName}</h1>
            <p className="max-w-xl text-fd-muted-foreground">{descriptions[lang]}</p>
            <Link href={localePath(lang, "/docs")} className="rounded-md bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground">
                {lang === "ja" ? "ドキュメントを読む" : "Read the docs"}
            </Link>
        </main>
    );
}
