"use client";
// CLI のログ。中身は、ビルドのときに本物の showRoutes() と logger() が出したもの(scripts/home-data.ts)
// 時刻だけ、見ているときの時刻に置き換える。画面の外では止め、動きを止める設定では最後の形を止めて出す
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import type { Line, LogEntry } from "@/lib/home/types";
import { useStill } from "./motion";

const TICK_MS = 700;
const KEEP = 5;
// 起動のコマンド → 起動中 → ルートの一覧 → ログ、の順に進める
const INTRO = ["$ bun run dev", "$ bun --watch src/index.ts"];
const READY_STEP = 5;
const RESET_STEP = 44;

function clock(d = new Date()) {
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

function Row({ line, wrap }: { line: Line; wrap?: boolean }) {
    if (line.length === 0) return <div className="gap" />;
    return (
        <div className={wrap ? "ln wrap" : "ln"}>
            {line.map((s, i) => (
                <span key={i} className={s.tone ? `t-${s.tone}` : undefined}>
                    {s.text}
                </span>
            ))}
        </div>
    );
}

type Shown = { line: Line; error: Line[]; key: number };

export function CliLog({ banner, logs, label }: { banner: Line[]; logs: LogEntry[]; label: string }) {
    const still = useStill();
    const ref = useRef<HTMLDivElement>(null);
    const [step, setStep] = useState(still ? READY_STEP : 0);
    const [shown, setShown] = useState<Shown[]>([]);
    const counter = useRef(0);

    // ログの1件。先頭の時刻(logger() の最初の区切り)を今の時刻にする
    function entry(log: LogEntry): Shown {
        const [time, ...rest] = log.line;
        return { line: [{ ...time!, text: clock() }, ...rest], error: log.error, key: counter.current++ };
    }

    useEffect(() => {
        if (still) {
            setStep(READY_STEP);
            setShown(logs.slice(-KEEP).map(entry));
            return;
        }
        let visible = false;
        const io = new IntersectionObserver(([e]) => {
            visible = e!.isIntersecting;
        });
        io.observe(ref.current!);
        const timer = setInterval(() => {
            if (!visible || document.hidden) return;
            setStep((s) => {
                if (s > RESET_STEP) {
                    setShown([]);
                    return 0;
                }
                if (s >= READY_STEP + 1) {
                    const log = logs[Math.floor(Math.random() * logs.length)]!;
                    setShown((list) => [...list, entry(log)].slice(-KEEP));
                }
                return s + 1;
            });
        }, TICK_MS);
        return () => {
            clearInterval(timer);
            io.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [still, logs]);

    const booting = step === 3 || step === 4;
    return (
        <div className="s-term" role="img" aria-label={label}>
            <div className="s-term-bar" aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
            <div ref={ref} className="s-term-body" aria-hidden="true">
                {INTRO.slice(0, Math.min(step, 2)).map((text, i) => (
                    <div key={text} className={i === 0 ? "ln t-cmd" : "ln t-dim"}>
                        {text}
                    </div>
                ))}
                {booting ? (
                    <div className="boot">
                        <svg className="s-spin" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                            <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="#D7DAE0" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        starting
                    </div>
                ) : null}
                {step >= READY_STEP ? (
                    <>
                        <div className="gap" />
                        {banner.map((line, i) => (
                            <Row key={i} line={line} wrap={i === 0} />
                        ))}
                        <div className="gap" />
                    </>
                ) : null}
                {/* 新しい行は、少しだけフェードしながら出す */}
                {shown.map((s) => (
                    <m.div key={s.key} initial={still ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
                        <Row line={s.line} />
                        {s.error.map((line, i) => (
                            <Row key={i} line={line} />
                        ))}
                    </m.div>
                ))}
                <span className="s-caret" />
            </div>
        </div>
    );
}
