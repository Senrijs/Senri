"use client";
// スムーズスクロール(docs/design/GridFull.dc.html の onWheel / smLoop)
// - ホイールに慣性をつける。ページ内リンク(#...)も同じ動きで移る。止まる位置はナビの高さ(64px)ぶんずらす
// - 慣性をかけないとき: Ctrl を押しているとき(拡大)、横スクロール、ダイアログを開いているとき、
//   中にスクロールできる箱(コードの欄など)があってその向きに動けるとき、動きを減らす設定のとき
// - キーボードやスクロールバーで動かしたら、慣性の目標を今の位置に合わせる
import { useEffect } from "react";
import { isStill } from "./still";

export const NAV_HEIGHT = 64;

const sm = { y: 0, ty: 0, on: false, raf: 0 };

const maxY = () => document.documentElement.scrollHeight - window.innerHeight;

function loop() {
    sm.y += (sm.ty - sm.y) * 0.1;
    if (Math.abs(sm.ty - sm.y) < 0.5) {
        sm.y = sm.ty;
        sm.on = false;
    }
    window.scrollTo({ top: sm.y, behavior: "instant" });
    sm.raf = sm.on ? requestAnimationFrame(loop) : 0;
}

function stop() {
    if (sm.raf) cancelAnimationFrame(sm.raf);
    sm.raf = 0;
    sm.on = false;
    sm.y = sm.ty = window.scrollY;
}

// その位置まで動く。動きを止めるときは、すぐその位置へ
export function smoothTo(y: number) {
    const top = Math.max(0, Math.min(maxY(), y));
    if (isStill()) {
        stop();
        window.scrollTo({ top, behavior: "instant" });
        return;
    }
    if (!sm.on) sm.y = window.scrollY;
    sm.ty = top;
    if (!sm.on) {
        sm.on = true;
        sm.raf = requestAnimationFrame(loop);
    }
}

// ダイアログ(このページのもの、検索、<dialog>)が開いているか
const dialogOpen = () => document.querySelector('[aria-modal="true"], dialog[open], [role="dialog"]') !== null;

// target からページまでの間に、その向きにまだスクロールできる箱があるか
function innerScrolls(target: EventTarget | null, dy: number): boolean {
    for (let el = target instanceof Element ? target : null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        if (el.scrollHeight <= el.clientHeight) continue;
        const oy = getComputedStyle(el).overflowY;
        if (oy !== "auto" && oy !== "scroll") continue;
        if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
    return false;
}

export function SmoothScroll() {
    useEffect(() => {
        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey || isStill() || Math.abs(e.deltaX) > Math.abs(e.deltaY) || dialogOpen() || innerScrolls(e.target, e.deltaY)) {
                if (sm.on) stop();
                return;
            }
            e.preventDefault();
            const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
            smoothTo((sm.on ? sm.ty : window.scrollY) + d);
        };
        // ページ内リンク。同じページの #id なら、慣性で動く
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const a = (e.target as Element | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
            if (!a) return;
            const url = new URL(a.href, location.href);
            if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
            const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
            if (!el) return;
            e.preventDefault();
            history.replaceState(history.state, "", url.hash);
            smoothTo(el.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT);
        };
        // 慣性で動いていないときのスクロール(キーボード、スクロールバー)では、目標を今の位置にする
        const onScroll = () => {
            if (!sm.on) sm.y = sm.ty = window.scrollY;
        };
        // 自分で動かし始めたら、慣性は止める
        const onKey = (e: KeyboardEvent) => {
            if (sm.on && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) stop();
        };
        const onPointer = () => {
            if (sm.on) stop();
        };
        window.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("keydown", onKey);
        window.addEventListener("pointerdown", onPointer);
        window.addEventListener("touchstart", onPointer, { passive: true });
        document.addEventListener("click", onClick);
        return () => {
            stop();
            window.removeEventListener("wheel", onWheel);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("pointerdown", onPointer);
            window.removeEventListener("touchstart", onPointer);
            document.removeEventListener("click", onClick);
        };
    }, []);
    return null;
}
