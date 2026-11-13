"use client";
// CLI: ターミナルが画面に入ると、コマンドが 1 文字ずつ打たれ、起動してルートの一覧が出て、リクエストのログが流れる
// 一覧とログは、ビルドのときに本物の showRoutes() と logger() が出したもの(scripts/home-data.ts)。時刻だけ今の時刻にする
// 404 のログには、開発モードのレスポンスに出る「もしかして」を添える
// 画面の外やタブが裏のときはタイマーを動かさない。動きを止める設定では、最後の形を止めて出す
import { useEffect, useRef, useState } from "react";
import type { Line, LogEntry } from "@/lib/home/types";
import type { Lang } from "@/lib/i18n";
import { useStill } from "./still";

const L1 = "npm create senri@latest my-app -- --template bun";
const L2 = "cd my-app && bun run dev";
const KEEP = 4;

function clock(d = new Date()) {
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

const TONE: Record<string, string> = {
    dim: "wd",
    green: "gr",
    cyan: "b",
    yellow: "y",
    red: "r",
    magenta: "fn",
    accent: "sl",
    bold: "sn",
};

function Row({ line }: { line: Line }) {
    if (line.length === 0) return <div>&nbsp;</div>;
    return (
        <div>
            {line.map((s, i) => (
                <span key={i} className={s.tone ? TONE[s.tone] : undefined}>
                    {s.text}
                </span>
            ))}
        </div>
    );
}

type Shown = { entry: LogEntry; time: string; key: number };

export function Cli({ lang, banner, logs, label, booting }: { lang: Lang; banner: Line[]; logs: LogEntry[]; label: string; booting: string }) {
    const still = useStill();
    const ref = useRef<HTMLDivElement>(null);
    // phase 0: 1 行目を打つ / 1: 2 行目を打つ / 2: 起動中 / 3: 一覧とログ
    const [s, setS] = useState({ phase: 0, t1: 0, t2: 0 });
    const [shown, setShown] = useState<Shown[]>([]);
    const n = useRef(0);
    const key = useRef(0);

    useEffect(() => {
        if (still) {
            setS({ phase: 3, t1: L1.length, t2: L2.length });
            setShown(logs.slice(-KEEP).map((entry) => ({ entry, time: clock(), key: key.current++ })));
            return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let visible = false;
        // 進み具合はここで持ち、次の待ち時間もここで決める
        // (setState の更新関数は、あとで呼ばれたり、StrictMode では 2 回呼ばれたりするので、中で待ち時間やログを決めない)
        const cur = { phase: 0, t1: 0, t2: 0 };
        // 最初から(打鍵もログも空に)。始めるときと、画面から出たときに戻す
        const reset = () => {
            cur.phase = cur.t1 = cur.t2 = 0;
            setS({ ...cur });
            setShown([]);
        };
        reset();
        const tick = () => {
            timer = undefined;
            if (!visible || document.hidden) return;
            let wait = 45;
            if (cur.phase === 0) {
                if (cur.t1 < L1.length) cur.t1++;
                else {
                    cur.phase = 1;
                    wait = 400;
                }
            } else if (cur.phase === 1) {
                if (cur.t2 < L2.length) cur.t2++;
                else {
                    cur.phase = 2;
                    wait = 900;
                }
            } else if (cur.phase === 2) {
                cur.phase = 3;
                wait = 700;
            } else {
                wait = 1100 + Math.random() * 900;
                const item = { entry: logs[n.current++ % logs.length]!, time: clock(), key: key.current++ };
                setShown((list) => [...list, item].slice(-KEEP));
            }
            setS({ ...cur });
            timer = setTimeout(tick, wait);
        };
        const resume = () => {
            if (visible && !document.hidden && !timer) timer = setTimeout(tick, 300);
        };
        const pause = () => {
            clearTimeout(timer);
            timer = undefined;
        };
        const io = new IntersectionObserver(
            ([e]) => {
                visible = e!.isIntersecting;
                if (visible) resume();
                else {
                    // 画面から出たら止めて、最初に戻す(次に入ったとき、打つところから見せる。前のログは残さない)
                    pause();
                    reset();
                }
            },
            { threshold: 0.3 },
        );
        io.observe(ref.current!);
        const onVis = () => (document.hidden ? pause() : resume());
        document.addEventListener("visibilitychange", onVis);
        return () => {
            pause();
            io.disconnect();
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [still, logs]);

    const { phase } = s;
    return (
        <div ref={ref} className="win tm" role="img" aria-label={label}>
            <div className="tbar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span className="ttl">zsh — my-app</span>
            </div>
            <div className="tmb" aria-hidden="true">
                <div>
                    <span className="wd">$</span> {L1.slice(0, s.t1)}
                    {phase === 0 ? <span className="caret" /> : null}
                </div>
                {phase >= 1 ? (
                    <div>
                        <span className="wd">$</span> {L2.slice(0, s.t2)}
                        {phase === 1 ? <span className="caret" /> : null}
                    </div>
                ) : null}
                {phase === 2 ? (
                    <div className="wd">
                        {"  "}
                        <span className="spin">●</span> {booting}
                    </div>
                ) : null}
                {phase >= 3 ? (
                    <>
                        <div>&nbsp;</div>
                        {banner.map((line, i) => (
                            <Row key={i} line={line} />
                        ))}
                        <div>&nbsp;</div>
                    </>
                ) : null}
                {shown.map(({ entry, time, key: k }) => {
                    // 先頭の区切りは時刻(logger() の書き方)。今の時刻に置き換える
                    const rest = entry.line.slice(1);
                    return (
                        <div key={k} className="logl" style={{ flexDirection: "column" }}>
                            <div>
                                <span className="wd">{time}</span>
                                {rest.map((seg, i) => (
                                    <span key={i} className={seg.tone ? TONE[seg.tone] : undefined}>
                                        {seg.text}
                                    </span>
                                ))}
                                {entry.note ? <span className="y">{`  ${entry.note[lang]}`}</span> : null}
                            </div>
                            {entry.error.map((line, i) => (
                                <Row key={i} line={line} />
                            ))}
                        </div>
                    );
                })}
                {phase >= 3 ? <span className="caret" /> : null}
            </div>
        </div>
    );
}
