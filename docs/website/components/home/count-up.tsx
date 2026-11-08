"use client";
// 画面に入ったときに、0 から数える数字(1回だけ)
// Motion Primitives の AnimatedNumber(https://github.com/ibelick/motion-primitives、MIT)と同じ見た目を、自分で作ったもの
// Motion の useSpring を使うと、Motion の動きの仕組みが最初に読む JavaScript に入るので、requestAnimationFrame で数える
// - サーバーで描くときと、動きを止めるときは、最後の数字をそのまま出す。描いたときに画面に見えている数字も数えない
// - 読み上げは最後の数字だけ(数えている途中の数字は aria-hidden)
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStill } from "./motion";

const DURATION = 1200;
const format = (n: number) => Math.round(n).toLocaleString("en-US");
// ばねに近い、最後にゆっくり止まる動き
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
    const still = useStill();
    const ref = useRef<HTMLElement>(null);
    const [shown, setShown] = useState(value);
    const [armed, setArmed] = useState(false);

    useLayoutEffect(() => {
        if (still || !ref.current) return;
        if (ref.current.getBoundingClientRect().top > window.innerHeight) {
            setShown(0);
            setArmed(true);
        }
    }, [still]);

    useEffect(() => {
        if (!armed || still || !ref.current) return;
        let raf = 0;
        const io = new IntersectionObserver(
            ([entry]) => {
                if (!entry!.isIntersecting) return;
                io.disconnect();
                const start = performance.now();
                const tick = (now: number) => {
                    const t = Math.min((now - start) / DURATION, 1);
                    setShown(value * easeOut(t));
                    if (t < 1) raf = requestAnimationFrame(tick);
                };
                raf = requestAnimationFrame(tick);
            },
            { threshold: 0.8 },
        );
        io.observe(ref.current);
        return () => {
            io.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [armed, still, value]);

    // 途中で「動きを止める」を押したら、最後の数字にする
    useEffect(() => {
        if (still) setShown(value);
    }, [still, value]);

    return (
        <b ref={ref}>
            <span className="sr-only">
                {format(value)}
                {suffix}
            </span>
            <span aria-hidden="true" style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(shown)}
                {suffix}
            </span>
        </b>
    );
}
