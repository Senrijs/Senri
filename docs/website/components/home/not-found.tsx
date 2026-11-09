"use client";
// サイトの 404 ページ(docs/design/site-not-found.dc.html)。1つの 404.html がどの URL にも返るので、
// ブラウザで今のパスを見て、言語(/en で始まれば英語)と「もしかして」を決める
// 描く前(JavaScript が動く前)は日本語で出し、英語の URL なら描いたあとで英語にする
import Link from "next/link";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { type Candidate, suggest } from "@/lib/suggest";
import { ArrowIcon } from "./icons";

const text = {
    ja: { notFound: "このページは見つかりませんでした。", maybe: "もしかして", top: "トップへ", docs: "ドキュメント", search: "検索", searchAria: "ドキュメントを検索" },
    en: { notFound: "This page could not be found.", maybe: "Did you mean", top: "Home", docs: "Docs", search: "Search", searchAria: "Search docs" },
};

export function langOfPath(path: string): Lang {
    return path === "/en" || path.startsWith("/en/") ? "en" : "ja";
}

export function NotFound({ lang, path, candidates }: { lang: Lang; path: string; candidates: Candidate[] }) {
    const t = text[lang];
    const { setOpenSearch } = useSearchContext();
    const [hit, setHit] = useState<string | null>(null);

    useEffect(() => {
        setHit(suggest(path, candidates));
    }, [path, candidates]);

    const home = lang === "en" ? "/en/" : "/";
    const docs = lang === "en" ? "/en/docs/" : "/docs/";
    return (
        <main className="s-nf">
            <div className="s-glow s-nf-glow" aria-hidden="true" />
            <div className="s-nf-body">
                <p className="s-nf-req mono">GET {path}</p>
                <h1 className="s-nf-code">404</h1>
                <p className="s-nf-msg">{t.notFound}</p>
                {hit ? (
                    <Link href={hit} className="s-nf-hit s-lg">
                        <span className="label">{t.maybe}</span>
                        <span className="path mono">{hit.replace(/\/$/, "") || "/"}</span>
                        <ArrowIcon />
                    </Link>
                ) : null}
                <nav className="s-nf-links" aria-label="404">
                    <Link href={home}>{t.top}</Link>
                    <Link href={docs}>{t.docs}</Link>
                    <button type="button" onClick={() => setOpenSearch(true)} aria-label={t.searchAria} aria-keyshortcuts="Meta+K Control+K">
                        {t.search} <kbd className="mono">⌘K</kbd>
                    </button>
                </nav>
            </div>
        </main>
    );
}
