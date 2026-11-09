"use client";
// ヒーローの、画面に貼り付く部分。スクロールすると中身ごと縮みながら薄くなって引いていく
// - React の state は使わず、スクロールのたびに(requestAnimationFrame で1コマに1回)transform と opacity を直接書き換える
// - 画面の外にあるときは何もしない。動きを止める設定では、貼り付けずにふつうに並べる(home.css)
import { type ReactNode, useEffect, useRef } from "react";
import { useStill } from "./motion";

export function HeroStage({ cue, children }: { cue: string; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const still = useStill();

    useEffect(() => {
        const stage = ref.current!;
        const section = stage.parentElement!;
        const inner = stage.querySelector<HTMLElement>("[data-hero-inner]");
        const cueEl = stage.querySelector<HTMLElement>("[data-hero-cue]");
        const reset = () => {
            if (inner) {
                inner.style.transform = "";
                inner.style.opacity = "";
            }
            if (cueEl) cueEl.style.opacity = "";
        };
        if (still) {
            reset();
            return;
        }
        let raf = 0;
        let visible = true;
        const apply = () => {
            raf = 0;
            if (!visible) return;
            const rect = section.getBoundingClientRect();
            const range = Math.max(1, rect.height - window.innerHeight);
            const h = Math.min(1, Math.max(0, -rect.top / range));
            if (inner) {
                inner.style.transform = `translateY(${Math.round(-h * 60)}px) scale(${(1 - h * 0.25).toFixed(3)})`;
                inner.style.opacity = Math.max(0, 1 - h * 1.4).toFixed(3);
            }
            if (cueEl) cueEl.style.opacity = Math.max(0, 1 - h * 6).toFixed(3);
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(apply);
        };
        const io = new IntersectionObserver(([entry]) => {
            visible = entry!.isIntersecting;
            onScroll();
        });
        io.observe(section);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        apply();
        return () => {
            cancelAnimationFrame(raf);
            io.disconnect();
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            reset();
        };
    }, [still]);

    return (
        <div ref={ref} className="s-hero-stage">
            {children}
            <div className="s-cue" data-hero-cue aria-hidden="true">
                {cue}
                <span />
            </div>
        </div>
    );
}
