"use client";
// 動きを止めるか(OS の「視差効果を減らす」か、フッターの「動きを止める」)と、狭い画面か
// フッターのボタンは components/home/motion.ts が <html data-motion="off"> を付ける
import { useEffect, useState } from "react";
import { useStill } from "@/components/home/motion";

// 貼り付けた箱に中身が収まらない、低い画面(スマホの横向きなど)。top.css の @media (max-height: 599px) と同じ
export const SHORT = "(max-height: 599px)";

export function isStill(): boolean {
    return document.documentElement.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useMedia(query: string): boolean {
    const [match, setMatch] = useState(false);
    useEffect(() => {
        const m = window.matchMedia(query);
        const on = () => setMatch(m.matches);
        on();
        m.addEventListener("change", on);
        return () => m.removeEventListener("change", on);
    }, [query]);
    return match;
}

// ストーリースクロールを縦に並べるか(描いたあとで決める。サーバーで描くときは貼り付ける形)
export function useStatic(): boolean {
    const still = useStill();
    const short = useMedia(SHORT);
    const [on, setOn] = useState(false);
    useEffect(() => setOn(still || short), [still, short]);
    return on;
}

export { useStill };
