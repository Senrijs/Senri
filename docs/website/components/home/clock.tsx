"use client";
// 右下の今の日時。1秒ごとに文字だけを書き換える(React の state は使わない)。飾りなので読み上げない
import { useEffect, useRef } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

export function Clock({ className }: { className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const tick = () => {
            const d = new Date();
            if (ref.current) {
                ref.current.textContent = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            }
        };
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, []);
    return (
        <div ref={ref} className={className} aria-hidden="true">
            ----/--/-- --:--:--
        </div>
    );
}
