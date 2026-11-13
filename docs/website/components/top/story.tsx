"use client";
// ストーリースクロール(RUNTIMES・LAYERS・ROUTING)。中身はサーバーで描き、ここでは進み具合から段階を決めて data-step に入れる
// 見せ方は CSS(top.css の [data-step])。段階を選ぶボタン([data-goto])があれば、押すとその段階まで動く
// 狭い画面と動きを止める設定では、貼り付けずに縦に並べる(data-static)。そのときは最後の段階で止めるか(fixedLast)、ボタンで選ぶ
import { type ReactNode, useEffect, useRef, useState } from "react";
import { smoothTo } from "./smooth-scroll";
import { useStatic } from "./still";

export function progressOf(el: HTMLElement): number {
    const r = el.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    return span <= 0 ? 0 : Math.min(1, Math.max(0, -r.top / span));
}

// 画面の中にあるときだけ、スクロールのたびに(1 コマに 1 回)fn を呼ぶ
export function useScrollTick(ref: React.RefObject<HTMLElement | null>, active: boolean, fn: () => void) {
    const cb = useRef(fn);
    cb.current = fn;
    useEffect(() => {
        if (!active) return;
        const el = ref.current!;
        let raf = 0;
        let visible = false;
        const run = () => {
            raf = 0;
            cb.current();
        };
        const onScroll = () => {
            if (visible && !raf) raf = requestAnimationFrame(run);
        };
        const io = new IntersectionObserver(([e]) => {
            visible = e!.isIntersecting;
            if (visible) onScroll();
        });
        io.observe(el);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        return () => {
            io.disconnect();
            cancelAnimationFrame(raf);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, [ref, active]);
}

export function Story({
    className,
    steps,
    height,
    label,
    fixedLast,
    children,
}: {
    className: string;
    steps: number;
    height: number;
    label: string;
    fixedLast?: boolean;
    children: ReactNode;
}) {
    const ref = useRef<HTMLElement>(null);
    const still = useStatic();
    const [step, setStep] = useState(0);

    useEffect(() => {
        if (still && fixedLast) setStep(steps - 1);
    }, [still, fixedLast, steps]);

    useScrollTick(ref, !still, () => {
        setStep(Math.min(steps - 1, Math.floor(progressOf(ref.current!) * steps)));
    });

    function onClick(e: React.MouseEvent) {
        const b = (e.target as Element).closest("[data-goto]");
        if (!b) return;
        const i = Number(b.getAttribute("data-goto"));
        if (still) {
            setStep(i);
            return;
        }
        // その段階の真ん中まで動く
        const el = ref.current!;
        const top = el.getBoundingClientRect().top + window.scrollY;
        smoothTo(top + ((el.offsetHeight - window.innerHeight) * (i + 0.5)) / steps);
    }

    return (
        <section
            ref={ref}
            className={`ss ${className}`}
            style={{ height }}
            aria-label={label}
            data-step={step}
            data-static={still ? "" : undefined}
            onClick={onClick}
        >
            {children}
        </section>
    );
}
