"use client";
// FEATURES の、横に流れるギャラリー。画面に貼り付き、縦のスクロールでカードが横に流れる
// - React の state は使わず、スクロールのたびに(1コマに1回)帯の transform と、下の進み具合のバーを直接書き換える
// - 狭い画面と、動きを止める設定では、貼り付けずにふつうの横スクロール(1枚ずつ止まる)にする(home.css)
//   指で操作するときは、貼り付いた横スクロールより使いやすいため
// - Tab でカードに移ったら、そのカードが見える位置までページを動かす(画面の外のカードにフォーカスが行かないように)
// - 動くカードには backdrop-filter を付けない(重いため)
import { type ReactNode, useEffect, useRef } from "react";
import { useStill } from "./motion";

const WIDE = "(min-width: 721px)";
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

// ease(g) = target となる g を探す(ease は増えるだけなので、二分探索で足りる)
function inverseEase(target: number): number {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (ease(mid) < target) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

export function Gallery({ heading, children }: { heading: ReactNode; children: ReactNode }) {
    const ref = useRef<HTMLElement>(null);
    const still = useStill();

    useEffect(() => {
        const section = ref.current!;
        const track = section.querySelector<HTMLElement>("[data-track]");
        const bar = section.querySelector<HTMLElement>("[data-gal-bar]");
        if (!track) return;
        const media = window.matchMedia(WIDE);
        let raf = 0;
        let visible = false;

        // 動かす距離: 最後のカードが、最初のカードのあった位置に来るまで(カード3枚分)
        const distance = () => {
            const cards = track.querySelectorAll<HTMLElement>(".s-card");
            if (cards.length < 2) return 0;
            return cards[cards.length - 1]!.offsetLeft - cards[0]!.offsetLeft;
        };
        const progress = () => {
            const rect = section.getBoundingClientRect();
            return clamp(-rect.top / Math.max(1, rect.height - window.innerHeight));
        };
        const active = () => !still && media.matches;
        const reset = () => {
            track.style.transform = "";
            if (bar) bar.style.width = "";
        };
        const apply = () => {
            raf = 0;
            if (!active()) return reset();
            if (!visible) return;
            const g = progress();
            track.style.transform = `translateX(${-Math.round(distance() * ease(g))}px)`;
            if (bar) bar.style.width = `${Math.round(g * 100)}%`;
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(apply);
        };
        // フォーカスしたカードが見える位置まで、ページを動かす
        const onFocus = (e: FocusEvent) => {
            if (!active()) return;
            const card = (e.target as HTMLElement).closest<HTMLElement>(".s-card");
            if (!card) return;
            const cards = [...track.querySelectorAll<HTMLElement>(".s-card")];
            const d = distance();
            if (d <= 0) return;
            const shift = Math.min(d, card.offsetLeft - cards[0]!.offsetLeft);
            const g = inverseEase(shift / d);
            const rect = section.getBoundingClientRect();
            const top = window.scrollY + rect.top + g * (rect.height - window.innerHeight);
            window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
        };

        const io = new IntersectionObserver(([entry]) => {
            visible = entry!.isIntersecting;
            onScroll();
        });
        io.observe(section);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        media.addEventListener("change", onScroll);
        track.addEventListener("focusin", onFocus);
        apply();
        return () => {
            cancelAnimationFrame(raf);
            io.disconnect();
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            media.removeEventListener("change", onScroll);
            track.removeEventListener("focusin", onFocus);
            reset();
        };
    }, [still]);

    return (
        <section ref={ref} id="features" className="s-gal" aria-labelledby="feat-title">
            <div className="s-gal-stage">
                <div className="s-glow" style={{ left: "-8%", top: "18%", width: 680, height: 680 }} aria-hidden="true" />
                <div
                    className="s-glow"
                    style={{ right: "-6%", bottom: "-12%", width: 600, height: 600, background: "radial-gradient(closest-side, rgba(255,150,80,0.2), rgba(255,150,80,0))" }}
                    aria-hidden="true"
                />
                <div className="s-gal-pad">{heading}</div>
                {children}
                <div className="s-gal-pad" aria-hidden="true">
                    <div className="s-gal-bar">
                        <div data-gal-bar />
                    </div>
                </div>
            </div>
        </section>
    );
}
