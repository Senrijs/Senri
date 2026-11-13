"use client";
// PATTERNS: PREV / NEXT で切り替えるカルーセル。見えていないスライドは inert にして、フォーカスも読み上げも外す
import { type ReactNode, useState } from "react";
import { gridDict } from "@/lib/home/grid-dict";
import type { Lang } from "@/lib/i18n";
import { Plus } from "./plus";

export function Patterns({ lang, codes }: { lang: Lang; codes: ReactNode[] }) {
    const t = gridDict[lang];
    const [i, setI] = useState(0);
    const n = t.slides.length;
    return (
        <section aria-roledescription="carousel" aria-label={t.patAria}>
            <div className="row">
                <div className="box">
                    <Plus />
                    <div className="head">
                        <h2 className="big">PATTERNS</h2>
                        <div className="carnav">
                            <span className="pos" aria-live="polite">
                                <span aria-hidden="true">
                                    {String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
                                </span>
                                <span className="sr-only">{t.slideOf(i + 1, n)}</span>
                            </span>
                            <button type="button" onClick={() => setI((i + n - 1) % n)} aria-label={t.prev}>
                                PREV
                            </button>
                            <button type="button" onClick={() => setI((i + 1) % n)} aria-label={t.next}>
                                NEXT
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="row">
                <div className="box slides">
                    <Plus />
                    <div className="track" style={{ transform: `translateX(-${i * 100}%)` }}>
                        {t.slides.map((s, k) => (
                            <div
                                key={s.title}
                                className="slide"
                                role="group"
                                aria-roledescription="slide"
                                aria-label={t.slideOf(k + 1, n)}
                                aria-hidden={k !== i}
                                inert={k !== i}
                            >
                                <div className="cell">
                                    <span className="num">{String(k + 1).padStart(2, "0")}</span>
                                    <h3>{s.title}</h3>
                                    <p>{s.desc}</p>
                                </div>
                                <div className="cell">
                                    <pre className="pc">{codes[k]}</pre>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
