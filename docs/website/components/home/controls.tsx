"use client";
// ナビ、メニュー、フッターで使うボタン(検索、言語、テーマ、動き)
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { homeDict } from "@/lib/home/dict";
import type { Lang } from "@/lib/i18n";
import { GlobeIcon, MoonIcon, PauseIcon, PlayIcon, SearchIcon, SunIcon } from "./icons";
import { applyStoredMotion, setMotionOff, useMotionOff } from "./motion";

// テーマは描いたあとでしか分からないので、それまではライトとして描く(ずれの警告を出さないため)
function useDark() {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const dark = mounted && resolvedTheme === "dark";
    return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

export function SearchButton({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const { setOpenSearch } = useSearchContext();
    return (
        <button
            type="button"
            className="s-pill s-search-btn"
            onClick={() => setOpenSearch(true)}
            aria-label={t.search}
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
        >
            <SearchIcon size={14} />
            <span className="s-hide-sm">{t.searchShort}</span>
            <kbd className="s-kbd s-hide-sm">⌘K</kbd>
        </button>
    );
}

export function ThemeButton({ lang, variant }: { lang: Lang; variant: "icon" | "text" | "menu" }) {
    const t = homeDict[lang];
    const { dark, toggle } = useDark();
    const label = dark ? t.toLight : t.toDark;
    if (variant === "icon") {
        return (
            <button type="button" className="s-pill s-icon-btn s-hide-sm" onClick={toggle} aria-label={label}>
                {dark ? <SunIcon /> : <MoonIcon />}
            </button>
        );
    }
    return (
        <button type="button" className={variant === "text" ? "s-pill" : undefined} onClick={toggle} aria-label={label}>
            {variant === "text" ? dark ? <SunIcon size={14} /> : <MoonIcon size={14} /> : null}
            {dark ? t.toLightShort : t.toDarkShort}
        </button>
    );
}

// 今のページの、もう一方の言語の URL(日本語は /、英語は /en)
export function useAltHref(lang: Lang): string {
    const path = usePathname() || "/";
    if (lang === "ja") return path === "/" ? "/en/" : `/en${path}`;
    const rest = path.replace(/^\/en(?=\/|$)/, "");
    return rest === "" ? "/" : rest;
}

export function LangLink({ lang, variant }: { lang: Lang; variant: "nav" | "text" }) {
    const t = homeDict[lang];
    const href = useAltHref(lang);
    const other = lang === "ja" ? "en" : "ja";
    if (variant === "nav") {
        return (
            <Link className="s-pill s-lang-btn s-hide-sm" href={href} hrefLang={other} aria-label={t.langAria}>
                {t.langBtn}
            </Link>
        );
    }
    return (
        <Link className="s-pill" href={href} hrefLang={other} aria-label={t.langAria}>
            <GlobeIcon size={14} strokeWidth={2} />
            {t.fLang}
        </Link>
    );
}

export function MotionButton({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const off = useMotionOff();
    useEffect(applyStoredMotion, []);
    return (
        <button type="button" className="s-pill" aria-pressed={off} onClick={() => setMotionOff(!off)}>
            {off ? <PlayIcon /> : <PauseIcon />}
            {off ? t.motionOn : t.motionOff}
        </button>
    );
}
