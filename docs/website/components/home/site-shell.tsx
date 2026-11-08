// トップページとブログの外側: 本文へ移動のリンク、読んだ量のバー、ナビ、フッター、グレイン
// 中のページは <main id="main"> を置く
import Link from "next/link";
import type { ReactNode } from "react";
import { homeDict } from "@/lib/home/dict";
import { type Lang, localePath } from "@/lib/i18n";
import { githubUrl } from "@/lib/shared";
import { LangLink, MotionButton, ThemeButton } from "./controls";
import { SiteHeader } from "./site-header";
import { Wordmark } from "./wordmark";
import "./home.css";

export function SiteShell({ lang, children }: { lang: Lang; children: ReactNode }) {
    const t = homeDict[lang];
    return (
        <div className="site">
            <a className="s-skip" href="#main">
                {t.skip}
            </a>
            <div className="s-progress" aria-hidden="true" />
            <SiteHeader lang={lang} wordmark={<Wordmark height={24} />} />
            {children}
            <SiteFooter lang={lang} />
            <div className="s-grain" aria-hidden="true" />
        </div>
    );
}

function SiteFooter({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const docs = (path: string) => localePath(lang, `/docs${path}`);
    const groups = [
        {
            title: t.fDocs,
            links: [
                { href: docs("/getting-started/installation"), text: t.fStart },
                { href: docs("/routing/routes"), text: t.fRouting },
                { href: docs("/middleware/writing"), text: t.fMw },
                { href: docs("/dev/devtools"), text: t.fDev },
            ],
        },
        {
            title: t.fCommunity,
            links: [
                { href: githubUrl, text: "GitHub" },
                { href: `${githubUrl}/issues`, text: t.fIssues },
                { href: `${githubUrl}/releases`, text: t.fReleases },
                { href: localePath(lang, "/blog"), text: t.navBlog },
            ],
        },
        {
            title: t.fPkgs,
            links: [
                { href: "https://www.npmjs.com/package/@senrijs/senri", text: "npm" },
                { href: "https://jsr.io/@senrijs/senri", text: "JSR" },
                { href: "https://www.npmjs.com/package/create-senri", text: "create-senri" },
            ],
        },
    ];
    return (
        <footer className="s-footer">
            <div className="s-wrap">
                <div className="cols">
                    <div className="brand">
                        <Link href={localePath(lang, "/")} aria-label="Senri" className="s-wordmark" style={{ display: "inline-flex" }}>
                            <Wordmark height={30} />
                        </Link>
                        <p>{t.heroP}</p>
                    </div>
                    {groups.map((g) => (
                        <nav key={g.title} aria-label={g.title}>
                            <h3>{g.title}</h3>
                            <ul>
                                {g.links.map((l) => (
                                    <li key={l.href}>
                                        <Link className="s-link" href={l.href}>
                                            {l.text}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    ))}
                    <div className="site-col">
                        <h3>{t.fSite}</h3>
                        <div className="controls">
                            <LangLink lang={lang} variant="text" />
                            <ThemeButton lang={lang} variant="text" />
                            <MotionButton lang={lang} />
                        </div>
                    </div>
                </div>
                <div className="bottom">
                    <span>MIT License</span>
                    <span>{t.proverb}</span>
                </div>
            </div>
        </footer>
    );
}
