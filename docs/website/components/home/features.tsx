"use client";
// 特長のカード。マウスに合わせて少し傾き(ばねで戻る)、押すとその場からダイアログが広がる
import * as m from "motion/react-m";
import { type MouseEvent, type ReactNode, useState } from "react";
import { homeDict } from "@/lib/home/dict";
import { PLAYGROUND_CODE } from "@/lib/home/playground-code";
import type { Recording } from "@/lib/home/types";
import type { Lang } from "@/lib/i18n";
import { Bars } from "./demo";
import { ErrorBox } from "./error-box";
import { ExpandDialog, type Origin } from "./expand-dialog";
import { GlobeIcon, ListIcon, PulseIcon, WarnIcon } from "./icons";
import { useStill } from "./motion";

export function Features({ lang, error }: { lang: Lang; error: NonNullable<Recording["error"]> }) {
    const t = homeDict[lang];
    const still = useStill();
    const [open, setOpen] = useState<{ i: number; origin: Origin } | null>(null);

    const cards: { icon: ReactNode; title: string; desc: ReactNode; dialog: string; body: ReactNode }[] = [
        {
            icon: <GlobeIcon size={26} />,
            title: t.f0t,
            desc: t.f0d,
            dialog: t.o0,
            body: (
                <pre className="s-code">
                    <span className="c-cm">{"// Bun · Node.js · Deno"}</span>
                    {"\n"}
                    <span className="c-kw">import</span> {"{ serve } "}
                    <span className="c-kw">from</span> <span className="c-str">{'"@senrijs/senri/serve"'}</span>;{"\n"}
                    <span className="c-fn">serve</span>(app);{"\n\n"}
                    <span className="c-cm">{"// Cloudflare Workers"}</span>
                    {"\n"}
                    <span className="c-kw">export default</span> app;
                </pre>
            ),
        },
        {
            icon: <WarnIcon size={26} strokeWidth={1.6} />,
            title: t.f1t,
            desc: t.f1d,
            dialog: t.o1,
            body: <ErrorBox error={error} code={PLAYGROUND_CODE} file="app.ts" />,
        },
        {
            icon: <PulseIcon size={26} />,
            title: t.f2t,
            desc: (
                <>
                    <code>/_senri</code> {t.f2d}
                </>
            ),
            dialog: t.o2,
            body: (
                <div className="mono" style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 13 }}>
                    <dl className="s-kv">
                        <div>
                            <dt>{t.kvMethod}</dt>
                            <dd className="m-get">GET</dd>
                        </div>
                        <div>
                            <dt>{t.kvPath}</dt>
                            <dd>/users/42</dd>
                        </div>
                        <div>
                            <dt>{t.kvStatus}</dt>
                            <dd>200</dd>
                        </div>
                        <div>
                            <dt>{t.kvTime}</dt>
                            <dd>3 ms</dd>
                        </div>
                    </dl>
                    <Bars
                        rows={[
                            ["requestId", "var(--bar1)", 0, 100],
                            ["cors", "var(--bar2)", 4, 92],
                            ["auth", "var(--bar4)", 10, 80],
                            ["handler", "var(--accent)", 16, 62],
                        ]}
                    />
                </div>
            ),
        },
        {
            icon: <ListIcon size={26} />,
            title: t.f3t,
            desc: t.f3d,
            dialog: t.o3,
            body: (
                <pre className="s-code">
                    app.<span className="c-fn">use</span>(<span className="c-fn">requestId</span>());{"\n"}
                    app.<span className="c-fn">use</span>(<span className="c-fn">cors</span>());{"\n"}
                    app.<span className="c-fn">use</span>(<span className="c-fn">compress</span>());{"\n"}
                    app.<span className="c-fn">use</span>(<span className="c-str">{'"/api/*"'}</span>, <span className="c-fn">rateLimit</span>({"{ windowMs: "}
                    <span className="c-num">60_000</span>
                    {", limit: "}
                    <span className="c-num">100</span>
                    {" }"}));
                </pre>
            ),
        },
    ];

    const current = open ? cards[open.i]! : null;
    return (
        <>
            <div className="s-grid4 s-cards">
                {cards.map((card, i) => (
                    <TiltCard
                        key={card.title}
                        still={still}
                        ghost={open?.i === i}
                        onOpen={(origin) => setOpen({ i, origin })}
                    >
                        {card.icon}
                        <span className="t">{card.title}</span>
                        <span className="d">{card.desc}</span>
                    </TiltCard>
                ))}
            </div>
            {open && current ? (
                <ExpandDialog origin={open.origin} title={current.title} description={current.dialog} closeLabel={t.close} onClosed={() => setOpen(null)}>
                    {current.body}
                </ExpandDialog>
            ) : null}
        </>
    );
}

// マウスに合わせて傾くカード。Motion Primitives の Tilt を元にしたもの
// https://github.com/ibelick/motion-primitives/blob/120f64f6ca60348e251f929e9c81f11ccbe45eda/components/core/tilt.tsx
// MIT License, Copyright (c) 2024 ibelick(https://github.com/ibelick/motion-primitives/blob/main/LICENCE.md)
// 変えたところ:
// - useSpring と useTransform の代わりに animate とばねの transition を使う(Motion の動きの仕組みを、あとから読む分に入れるため)
// - <button> にした、光の当たる位置(--gx / --gy)も動かす、動きを止めるときは傾けない
const TILT = 6;
const SPRING = { type: "spring", stiffness: 260, damping: 22, mass: 0.6 } as const;

function TiltCard({ still, ghost, onOpen, children }: { still: boolean; ghost: boolean; onOpen: (origin: Origin) => void; children: ReactNode }) {
    const [tilt, setTilt] = useState({ x: 0, y: 0, hover: false });

    function move(e: MouseEvent<HTMLButtonElement>) {
        if (still) return;
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        setTilt({ x: px - 0.5, y: py - 0.5, hover: true });
        el.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
        el.style.setProperty("--shine", "1");
    }

    function leave(el: HTMLElement) {
        setTilt({ x: 0, y: 0, hover: false });
        el.style.removeProperty("--shine");
    }

    return (
        <m.button
            type="button"
            className={`s-card s-glass${ghost ? " ghost" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={ghost}
            style={{ transformPerspective: 900 }}
            animate={{ rotateX: -tilt.y * 2 * TILT, rotateY: tilt.x * 2 * TILT, scale: tilt.hover ? 1.02 : 1 }}
            transition={SPRING}
            whileTap={still ? undefined : { scale: 0.98 }}
            onMouseMove={move}
            onMouseLeave={(e) => leave(e.currentTarget)}
            onClick={(e) => {
                const el = e.currentTarget;
                leave(el);
                // 傾きを外した位置を測る(ダイアログが、まっすぐなカードから広がるように)
                const saved = el.style.transform;
                el.style.transform = "none";
                const rect = el.getBoundingClientRect();
                el.style.transform = saved;
                onOpen({ rect, opener: el });
            }}
        >
            <span className="shine" aria-hidden="true" />
            {children}
        </m.button>
    );
}
