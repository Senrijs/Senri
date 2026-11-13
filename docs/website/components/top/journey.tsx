"use client";
// JOURNEY: GET /users/42 が Router → requestId → cors → auth → handler と進み、戻ってくるストーリースクロール
// 進み具合 0〜0.8 で行き、0.8〜1 で戻る。光る点(packet)と線(jfill)は、state を通さずに style を直接書き換える
// 狭い画面と動きを止める設定では、貼り付けずに、戻ってきたあとの形と、場面の説明を全部並べる
import { useRef, useState } from "react";
import { gridDict } from "@/lib/home/grid-dict";
import type { Lang } from "@/lib/i18n";
import { Plus } from "./plus";
import { progressOf, useScrollTick } from "./story";
import { useStatic } from "./still";

export function Journey({ lang }: { lang: Lang }) {
    const t = gridDict[lang];
    const ref = useRef<HTMLElement>(null);
    const packet = useRef<HTMLDivElement>(null);
    const fill = useRef<HTMLDivElement>(null);
    const still = useStatic();
    const [state, setState] = useState({ step: 0, back: false });

    useScrollTick(ref, !still, () => {
        const p = progressOf(ref.current!);
        const go = Math.min(1, p / 0.8);
        const back = p > 0.8;
        const x = back ? 1 - (p - 0.8) / 0.2 : go;
        if (packet.current) packet.current.style.left = `${10 + x * 80}%`;
        if (fill.current) fill.current.style.width = `${back ? 0 : x * 80}%`;
        const step = back ? 4 : Math.min(4, Math.floor(go * 4 + 0.15));
        setState((s) => (s.step === step && s.back === back ? s : { step, back }));
    });

    const { step, back } = still ? { step: 4, back: true } : state;
    const scene = t.jScenes[back ? 4 : step]!;
    const onion = (i: number) => (back ? "done" : step >= i ? "on" : "");

    return (
        <section ref={ref} className="jscroll" aria-label={t.jAria} data-static={still ? "" : undefined}>
            <div className="jsticky">
                <div className="row">
                    <div className="box grid jgrid">
                        <Plus />
                        <div className="jline" aria-hidden="true" />
                        <div ref={fill} className="jfill" aria-hidden="true" />
                        <div ref={packet} className={back ? "packet back" : "packet"} aria-hidden="true" />
                        {t.jNodes.map(([name, desc], i) => (
                            <div key={name} className={step >= i ? "cell jn on" : "cell jn"}>
                                <span className="jnum">{String(i + 1).padStart(2, "0")}</span>
                                <span className="dot" aria-hidden="true" />
                                <b>{name}</b>
                                <span className="jd">{desc}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="row">
                    <div className="box jcap">
                        <Plus />
                        <div className="now">
                            <span className="jno">{String((back ? 4 : step) + 1).padStart(2, "0")} — 05</span>
                            <h3>{scene[0]}</h3>
                            <p>{scene[1]}</p>
                        </div>
                        <ol>
                            {t.jScenes.map(([title, body], i) => (
                                <li key={title}>
                                    <span className="jno">{String(i + 1).padStart(2, "0")} — 05</span>
                                    <b>{title}</b>
                                    <p>{body}</p>
                                </li>
                            ))}
                        </ol>
                    </div>
                </div>
                <div className="row">
                    <div className="box jfoot">
                        <Plus />
                        <span>→ GET /users/42</span>
                        <span>{t.jDash}</span>
                        <span style={{ color: "#7fd6a0" }}>200 OK · 3.4ms ←</span>
                    </div>
                </div>
                <div className="row jrest">
                    <div className="box grid jviz">
                        <Plus />
                        <div className="cell jv">
                            <div className="jvh">REQUEST</div>
                            <pre className="jpre">
                                <span className="jm">GET</span> /users/42{"\n"}host: example.com{"\n"}accept: application/json{"\n"}authorization: Bearer ••••
                            </pre>
                        </div>
                        <div className="cell jv">
                            <div className="jvh">ONION — /_senri</div>
                            <div className="onion">
                                {(
                                    [
                                        ["requestId", "0.1ms"],
                                        ["cors", "0.2ms"],
                                        ["auth", "1.1ms"],
                                        ["handler", "1.6ms"],
                                    ] as const
                                ).map(([name, ms], i) => (
                                    <div key={name} className={`ol ${i === 3 ? "hd " : ""}${onion(i + 1)}`} style={{ "--i": i } as React.CSSProperties}>
                                        <span>{name}</span>
                                        <em>{ms}</em>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="cell jv">
                            <div className="jvh">RESPONSE</div>
                            {back ? (
                                <pre className="jpre">
                                    <span style={{ color: "#7fd6a0" }}>200 OK</span> <span style={{ color: "#8a9099" }}>3.4ms</span>
                                    {"\n"}content-type: application/json{"\n"}x-request-id: 7f3a…{"\n\n"}
                                    {'{"id": "42"}'}
                                </pre>
                            ) : (
                                <div className="jwait">
                                    <span className="spin" aria-hidden="true">
                                        ●
                                    </span>{" "}
                                    {t.jWait}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
