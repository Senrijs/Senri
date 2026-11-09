"use client";
// サイトのナビ(トップとブログ)。浮かぶカプセル型。幅が狭いときはハンバーガーメニューにする
// メニューは、ボタンの位置から下に向かってぼわんと広がる(home.css の s-menu-pop)
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { homeDict } from "@/lib/home/dict";
import { type Lang, localePath } from "@/lib/i18n";
import { githubUrl } from "@/lib/shared";
import { LangLink, SearchButton, ThemeButton, useAltHref } from "./controls";
import { AnimIcon } from "./anim-icon";
import { CloseIcon, MenuIcon } from "./icons";

export function SiteHeader({ lang, wordmark }: { lang: Lang; wordmark: React.ReactNode }) {
    const t = homeDict[lang];
    const altHref = useAltHref(lang);
    const [open, setOpen] = useState(false);
    const button = useRef<HTMLButtonElement>(null);
    const links = [
        { href: localePath(lang, "/docs"), text: t.docs },
        { href: `${localePath(lang, "/")}#timeline`, text: t.navTl },
        { href: localePath(lang, "/blog"), text: t.navBlog },
        { href: githubUrl, text: "GitHub" },
    ];

    // Esc で閉じて、ボタンにフォーカスを戻す
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setOpen(false);
            button.current?.focus();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    return (
        <header className="s-header">
            <nav className="s-nav s-lg" aria-label={t.nav}>
                <Link href={localePath(lang, "/")} aria-label="Senri" className="s-wordmark">
                    {wordmark}
                </Link>
                <div className="s-nav-links">
                    {links.map((l) => (
                        <Link key={l.href} className="s-link s-hide-sm" href={l.href}>
                            {l.text}
                        </Link>
                    ))}
                    <SearchButton lang={lang} />
                    <LangLink lang={lang} variant="nav" />
                    <ThemeButton lang={lang} variant="icon" />
                    <button
                        ref={button}
                        type="button"
                        className="s-menu-btn"
                        onClick={() => setOpen(!open)}
                        aria-expanded={open}
                        aria-controls="s-menu"
                        aria-label={open ? t.menuClose : t.menuOpen}
                    >
                        <AnimIcon name="menu" size={20} active={open} fallback={open ? <CloseIcon /> : <MenuIcon />} />
                    </button>
                </div>
            </nav>
            {open ? (
                <div id="s-menu" className="s-menu s-lg">
                    <ul>
                        {links.map((l) => (
                            <li key={l.href}>
                                <Link href={l.href} onClick={() => setOpen(false)}>
                                    {l.text}
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <div className="s-menu-actions">
                        <Link href={altHref} hrefLang={lang === "ja" ? "en" : "ja"} aria-label={t.langAria}>
                            {t.fLang}
                        </Link>
                        <ThemeButton lang={lang} variant="menu" />
                    </div>
                </div>
            ) : null}
        </header>
    );
}
