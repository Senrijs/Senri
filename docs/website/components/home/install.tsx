"use client";
// パッケージマネージャーの切り替えと、コマンドのコピー。コマンドは README と create-senri の README のとおり
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { homeDict } from "@/lib/home/dict";
import type { Lang } from "@/lib/i18n";
import { CopyIcon } from "./icons";

const COMMANDS = [
    ["npm", "npm create senri@latest"],
    ["pnpm", "pnpm create senri"],
    ["yarn", "yarn create senri"],
    ["bun", "bun create senri"],
    ["deno", "deno run -A npm:create-senri"],
] as const;

const KEY = "package-manager";

export function Install({ lang, docsHref }: { lang: Lang; docsHref: string }) {
    const t = homeDict[lang];
    const [pm, setPm] = useState(0);
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    // ドキュメントのインストールのタブ(remarkNpm)と同じ保存先を使い、選んだものを揃える
    useEffect(() => {
        try {
            const saved = localStorage.getItem(KEY);
            const i = COMMANDS.findIndex(([name]) => name === saved);
            if (i >= 0) setPm(i);
        } catch {
            // 読めなければ npm のまま
        }
        return () => clearTimeout(timer.current);
    }, []);

    function pick(i: number) {
        setPm(i);
        setCopied(false);
        try {
            localStorage.setItem(KEY, COMMANDS[i]![0]);
        } catch {
            // 保存できなくてもよい
        }
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(COMMANDS[pm]![1]);
        } catch {
            return;
        }
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
    }

    return (
        <>
            <div className="s-pms s-up d3" role="group" aria-label={t.pmGroup}>
                {COMMANDS.map(([name], i) => (
                    <button key={name} type="button" className="s-chip" aria-pressed={i === pm} onClick={() => pick(i)}>
                        {name}
                    </button>
                ))}
            </div>
            <div className="s-cta-row s-up d3">
                <button type="button" className="s-cmd" onClick={copy} aria-label={`${t.copyAria}: ${COMMANDS[pm]![1]}`}>
                    <span className="prompt">$</span>
                    {COMMANDS[pm]![1]}
                    {copied ? <span className="ok">Copied!</span> : <CopyIcon />}
                </button>
                <Link className="s-btn s-btn-solid" href={docsHref}>
                    {t.docs}
                </Link>
                <span className="sr-only" role="status">
                    {copied ? t.copied : ""}
                </span>
            </div>
        </>
    );
}
