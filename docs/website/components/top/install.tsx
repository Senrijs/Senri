"use client";
// パッケージマネージャーのタブと、コマンドのコピー(ヒーローと「はじめよう」の 2 か所)
// コマンドは README と create-senri の README のとおり。選んだものは、ドキュメントのインストールのタブと同じ保存先に置いて揃える
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { homeDict } from "@/lib/home/dict";
import type { Lang } from "@/lib/i18n";

const COMMANDS = [
    ["npm", "npm create senri@latest"],
    ["pnpm", "pnpm create senri"],
    ["yarn", "yarn create senri"],
    ["bun", "bun create senri"],
    ["deno", "deno run -A npm:create-senri"],
] as const;

const KEY = "package-manager";
const EVENT = "senri:package-manager";

function read(): number {
    try {
        const i = COMMANDS.findIndex(([name]) => name === localStorage.getItem(KEY));
        return i >= 0 ? i : 0;
    } catch {
        return 0;
    }
}

function subscribe(onChange: () => void) {
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
        window.removeEventListener(EVENT, onChange);
        window.removeEventListener("storage", onChange);
    };
}

export function Install({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    // 2 か所のタブを揃えるため、選んだものは localStorage と合図で配る
    const pm = useSyncExternalStore(subscribe, read, () => 0);
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);

    function pick(i: number) {
        setCopied(false);
        try {
            localStorage.setItem(KEY, COMMANDS[i]![0]);
        } catch {
            // 保存できなくても、合図だけ送る
        }
        window.dispatchEvent(new Event(EVENT));
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

    const cmd = COMMANDS[pm]![1];
    return (
        <div className="pm">
            <div className="pmtabs" role="group" aria-label={t.pmGroup}>
                {COMMANDS.map(([name], i) => (
                    <button key={name} type="button" aria-pressed={i === pm} onClick={() => pick(i)}>
                        {name}
                    </button>
                ))}
            </div>
            <button type="button" className="cmd" onClick={copy} aria-label={`${t.copyAria}: ${cmd}`}>
                <span className="dl" aria-hidden="true">
                    $
                </span>
                <span className="txt">{cmd}</span>
                {copied ? (
                    <span className="ok" aria-hidden="true">
                        Copied!
                    </span>
                ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" />
                        <path d="M5 15V5h10" />
                    </svg>
                )}
            </button>
            <span className="sr-only" role="status">
                {copied ? t.copied : ""}
            </span>
        </div>
    );
}
