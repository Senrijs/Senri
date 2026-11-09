"use client";
// 404 ページの外側。今の URL から言語を決めて、文言、検索の言語、<html lang> を合わせる
import type { I18nProviderProps } from "fumadocs-ui/contexts/i18n";
import { useEffect, useState } from "react";
import { Provider } from "@/components/provider";
import type { Lang } from "@/lib/i18n";
import type { Candidate } from "@/lib/suggest";
import { langOfPath, NotFound } from "./not-found";

export function NotFoundRoot({ providers, candidates }: { providers: Record<Lang, I18nProviderProps>; candidates: Record<Lang, Candidate[]> }) {
    const [where, setWhere] = useState<{ lang: Lang; path: string }>({ lang: "ja", path: "" });

    useEffect(() => {
        const path = window.location.pathname;
        const lang = langOfPath(path);
        document.documentElement.lang = lang;
        if (lang === "en") document.title = "404 Not Found | Senri";
        setWhere({ lang, path });
    }, []);

    return (
        <Provider i18n={providers[where.lang]}>
            <div className="site">
                <NotFound lang={where.lang} path={where.path} candidates={where.path ? candidates[where.lang] : []} />
            </div>
        </Provider>
    );
}
