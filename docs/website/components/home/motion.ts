"use client";
// 動きを止めるかどうか。OS の「視差効果を減らす」と、フッターの「動きを止める」ボタン(<html data-motion="off">)の両方を見る
// CSS のアニメーションは home.css が止める。ここはパーティクル、カルーセル、CLI など JavaScript で動かすもののため
import { useSyncExternalStore } from "react";

const KEY = "senri.motion";
const EVENT = "senri:motion";
const QUERY = "(prefers-reduced-motion: reduce)";

function stored(): boolean {
    try {
        return localStorage.getItem(KEY) === "off";
    } catch {
        return false;
    }
}

// ページを開いたときに、保存した設定を <html> に付ける
export function applyStoredMotion() {
    if (stored()) document.documentElement.dataset.motion = "off";
}

export function setMotionOff(off: boolean) {
    if (off) document.documentElement.dataset.motion = "off";
    else delete document.documentElement.dataset.motion;
    try {
        if (off) localStorage.setItem(KEY, "off");
        else localStorage.removeItem(KEY);
    } catch {
        // 保存できなくても、このページでは止まる
    }
    window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
    const media = window.matchMedia(QUERY);
    media.addEventListener("change", onChange);
    window.addEventListener(EVENT, onChange);
    return () => {
        media.removeEventListener("change", onChange);
        window.removeEventListener(EVENT, onChange);
    };
}

// フッターのボタンで止めたか
export function useMotionOff(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => document.documentElement.dataset.motion === "off",
        () => false,
    );
}

// JavaScript の動きを止めるべきか(サーバーで描くときは止めておく)
export function useStill(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => document.documentElement.dataset.motion === "off" || window.matchMedia(QUERY).matches,
        () => true,
    );
}
