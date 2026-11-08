"use client";
// 特長のカード。マウスに合わせて少し傾き、押すとその場からダイアログが広がる
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

    function tilt(e: MouseEvent<HTMLButtonElement>) {
        if (still) return;
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty("--rx", `${(-y * 12).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(x * 12).toFixed(2)}deg`);
        el.style.setProperty("--sc", "1.02");
        el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty("--shine", "1");
    }

    function reset(el: HTMLElement) {
        for (const name of ["--rx", "--ry", "--sc", "--gx", "--gy", "--shine"]) el.style.removeProperty(name);
    }

    const current = open ? cards[open.i]! : null;
    return (
        <>
            <div className="s-grid4 s-cards">
                {cards.map((card, i) => (
                    <button
                        key={card.title}
                        type="button"
                        className={`s-card s-glass${open?.i === i ? " ghost" : ""}`}
                        aria-haspopup="dialog"
                        aria-expanded={open?.i === i}
                        onMouseMove={tilt}
                        onMouseLeave={(e) => reset(e.currentTarget)}
                        onClick={(e) => {
                            reset(e.currentTarget);
                            setOpen({ i, origin: { rect: e.currentTarget.getBoundingClientRect(), opener: e.currentTarget } });
                        }}
                    >
                        <span className="shine" aria-hidden="true" />
                        {card.icon}
                        <span className="t">{card.title}</span>
                        <span className="d">{card.desc}</span>
                    </button>
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
