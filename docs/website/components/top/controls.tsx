"use client";
// ナビとフッターのボタン(検索、テーマ、言語、動き)。グリッド版の見た目のもの
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { applyStoredMotion, setMotionOff, useMotionOff } from "@/components/home/motion";
import { homeDict } from "@/lib/home/dict";
import type { Lang } from "@/lib/i18n";

// テーマは描いたあとでしか分からないので、それまではライトとして描く(ずれの警告を出さないため)
function useDark() {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const dark = mounted && resolvedTheme === "dark";
    return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

const Sun = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
);
const Moon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
);

// 今のページの、もう一方の言語の URL(日本語は /、英語は /en)
function useAltHref(lang: Lang): string {
    const path = usePathname() || "/";
    if (lang === "ja") return path === "/" ? "/en/" : `/en${path}`;
    const rest = path.replace(/^\/en(?=\/|$)/, "");
    return rest === "" ? "/" : rest;
}

export function SearchButton({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const { setOpenSearch } = useSearchContext();
    return (
        <button type="button" className="search" onClick={() => setOpenSearch(true)} aria-label={t.search} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4" />
            </svg>
            <span className="wide">{t.searchShort}</span>
            <kbd className="kbd wide">⌘K</kbd>
        </button>
    );
}

export function ThemeButton({ lang, text }: { lang: Lang; text?: boolean }) {
    const t = homeDict[lang];
    const { dark, toggle } = useDark();
    return (
        <button type="button" className={text ? undefined : "iconbtn"} onClick={toggle} aria-label={dark ? t.toLight : t.toDark}>
            {dark ? <Sun /> : <Moon />}
            {text ? (dark ? t.toLightShort : t.toDarkShort) : null}
        </button>
    );
}

export function LangLink({ lang, text }: { lang: Lang; text?: boolean }) {
    const t = homeDict[lang];
    const href = useAltHref(lang);
    return (
        <Link className={text ? "ctl" : "langl"} href={href} hrefLang={lang === "ja" ? "en" : "ja"} aria-label={t.langAria}>
            {text ? t.fLang : t.langBtn}
        </Link>
    );
}

export function MotionButton({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const off = useMotionOff();
    useEffect(applyStoredMotion, []);
    return (
        <button type="button" aria-pressed={off} onClick={() => setMotionOff(!off)}>
            {off ? t.motionOn : t.motionOff}
        </button>
    );
}
