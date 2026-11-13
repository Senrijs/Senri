// トップページとブログの外側(グリッド版): 本文へ移動のリンク、ナビ、フッター、四隅の表示、スムーズスクロール
// 中のページは <main id="main"> を置く
import Link from "next/link";
import type { ReactNode } from "react";
import { Clock } from "@/components/home/clock";
import { Wordmark } from "@/components/home/wordmark";
import { homeDict } from "@/lib/home/dict";
import data from "@/lib/home/generated.json";
import { gridDict } from "@/lib/home/grid-dict";
import type { HomeData } from "@/lib/home/types";
import { type Lang, localePath } from "@/lib/i18n";
import { githubUrl } from "@/lib/shared";
import { LangLink, MotionButton, SearchButton, ThemeButton } from "./controls";
import { Plus } from "./plus";
import { REVEAL_SCRIPT } from "./reveal";
import { RevealWatch } from "./reveal-watch";
import { SmoothScroll } from "./smooth-scroll";
import "./top.css";

export function GridShell({ lang, children }: { lang: Lang; children: ReactNode }) {
    const t = homeDict[lang];
    const g = gridDict[lang];
    const home = localePath(lang, "/");
    return (
            <div className="g">
                {/* 見出しの演出(components/top/reveal.tsx)。見出しより先に動かす */}
                <script dangerouslySetInnerHTML={{ __html: REVEAL_SCRIPT }} />
                <a className="skip" href="#main">
                    {t.skip}
                </a>
                <header className="row nav">
                    <nav className="box" aria-label={t.nav}>
                        <Link href={home} aria-label="Senri" className="wm">
                            <Wordmark height={24} />
                        </Link>
                        <span className="grow" />
                        <Link className="wide" href={localePath(lang, "/docs")}>
                            {t.docs}
                        </Link>
                        <a className="wide" href={`${home === "/" ? "" : home}/#timeline`}>
                            {t.navTl}
                        </a>
                        <Link className="wide" href={localePath(lang, "/blog")}>
                            {t.navBlog}
                        </Link>
                        <SearchButton lang={lang} />
                        <LangLink lang={lang} />
                        <ThemeButton lang={lang} />
                        <a className="btn dark wide" href={`${home === "/" ? "" : home}/#start`}>
                            {g.navStart}
                        </a>
                    </nav>
                </header>
                {children}
                <Footer lang={lang} />
                <div className="hud l" aria-hidden="true">
                    senr/ — v{(data as HomeData).version}
                </div>
                <Clock className="hud r" />
                <SmoothScroll />
                <RevealWatch />
            </div>
    );
}

function Footer({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const g = gridDict[lang];
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
        <footer>
            <div className="row">
                <div className="box grid foot">
                    <Plus />
                    <div className="cell">
                        <Link href={localePath(lang, "/")} aria-label="Senri" style={{ display: "inline-flex" }}>
                            <Wordmark height={26} />
                        </Link>
                        <p className="brandp">
                            {g.footBrand}
                            <br />
                            MIT License
                        </p>
                    </div>
                    {groups.map((group) => (
                        <nav key={group.title} className="cell" aria-label={group.title}>
                            <h3>{group.title}</h3>
                            <ul>
                                {group.links.map((l) => (
                                    <li key={l.href}>
                                        <Link href={l.href}>{l.text}</Link>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    ))}
                </div>
            </div>
            <div className="row">
                <div className="box fbar">
                    <Plus />
                    <span>{g.proverb}</span>
                    <span className="grow" />
                    <LangLink lang={lang} text />
                    <ThemeButton lang={lang} text />
                    <MotionButton lang={lang} />
                </div>
            </div>
        </footer>
    );
}
