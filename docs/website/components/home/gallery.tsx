"use client";
// FEATURES の、横に流れるギャラリー。画面に貼り付き、縦のスクロールでカードが右から左へ流れる(スマホでも同じ)
// - React の state は使わず、スクロールのたびに(1コマに1回)帯の transform と、下の進み具合のバーを直接書き換える
// - 貼り付けておく長さ(セクションの高さ)は、横に動く距離から出す: 縦のスクロール = 横の距離 × SCROLL_PER_PX
//   スマホ(カード 82vw × 4枚)なら、縦に 1.5 画面ほど(スワイプ数回)で最後のカードまで行く
// - 貼り付いている間は、カードの列を指で横にスワイプできない(touch-action: pan-y。縦のスクロールとぶつからないように)
// - 動きを止める設定では、貼り付けずにふつうの横スクロール(1枚ずつ止まる)にする(home.css)
// - Tab でカードに移ったら、そのカードが見える位置までページを動かす(画面の外のカードにフォーカスが行かないように)
// - 動くカードには backdrop-filter を付けない(重いため)
import { type ReactNode, useEffect, useRef } from "react";
import { useStill } from "./motion";

const SCROLL_PER_PX = 1.3;
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
        const stage = section.querySelector<HTMLElement>(".s-gal-stage");
        const track = section.querySelector<HTMLElement>("[data-track]");
        const bar = section.querySelector<HTMLElement>("[data-gal-bar]");
        if (!stage || !track) return;
        let raf = 0;
        let visible = false;

        // 動かす距離: 最後のカードが、最初のカードのあった位置に来るまで
        const distance = () => {
            const cards = track.querySelectorAll<HTMLElement>(".s-card");
            if (cards.length < 2) return 0;
            return cards[cards.length - 1]!.offsetLeft - cards[0]!.offsetLeft;
        };
        // 貼り付いている間に、縦にスクロールできる長さ
        const range = () => Math.max(1, section.offsetHeight - stage.offsetHeight);
        const progress = () => clamp(-section.getBoundingClientRect().top / range());
        const reset = () => {
            track.style.transform = "";
            section.style.height = "";
            if (bar) bar.style.width = "";
        };
        // セクションの高さを、画面の高さ + 横の距離 × SCROLL_PER_PX にする
        const size = () => {
            if (still) return reset();
            section.style.height = `${Math.round(stage.offsetHeight + distance() * SCROLL_PER_PX)}px`;
        };
        const apply = () => {
            raf = 0;
            if (still || !visible) return;
            const g = progress();
            track.style.transform = `translateX(${-Math.round(distance() * ease(g))}px)`;
            if (bar) bar.style.width = `${Math.round(g * 100)}%`;
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(apply);
        };
        const onResize = () => {
            size();
            onScroll();
        };
        // フォーカスしたカードが見える位置まで、ページを動かす
        const onFocus = (e: FocusEvent) => {
            if (still) return;
            const card = (e.target as HTMLElement).closest<HTMLElement>(".s-card");
            if (!card) return;
            const cards = [...track.querySelectorAll<HTMLElement>(".s-card")];
            const d = distance();
            if (d <= 0) return;
            const shift = Math.min(d, card.offsetLeft - cards[0]!.offsetLeft);
            const g = inverseEase(shift / d);
            const top = window.scrollY + section.getBoundingClientRect().top + g * range();
            window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
        };

        if (still) {
            reset();
            return;
        }
        size();
        const io = new IntersectionObserver(([entry]) => {
            visible = entry!.isIntersecting;
            onScroll();
        });
        io.observe(section);
        // カードの幅や画面の高さが変わったら、高さを出し直す(フォントの読み込みやスマホのアドレスバーなど)
        const ro = new ResizeObserver(onResize);
        ro.observe(stage);
        ro.observe(track);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize);
        track.addEventListener("focusin", onFocus);
        apply();
        return () => {
            cancelAnimationFrame(raf);
            io.disconnect();
            ro.disconnect();
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
            track.removeEventListener("focusin", onFocus);
            reset();
        };
    }, [still]);

    return (
        <section ref={ref} id="features" className="s-gal" aria-labelledby="feat-title">
            <div className="s-gal-stage">
                {/* 背景のぼかしは、箱の中に収まる位置に置く(箱の下の端で切れて、段に見えないように) */}
                <div className="s-glow" style={{ left: "-8%", top: "18%", width: 680, height: 680 }} aria-hidden="true" />
                <div
                    className="s-glow"
                    style={{ right: "-6%", bottom: 0, width: 600, height: 600, background: "radial-gradient(closest-side, rgba(255,150,80,0.2), rgba(255,150,80,0))" }}
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
