"use client";
// よくある使い方のカルーセル。4.8 秒ごとに進み、マウスを乗せている間とフォーカスが中にある間は止まる
// 自動で進む間は読み上げない(aria-live="off")。前へ・次へ・点を押したあとは読み上げる
import { useEffect, useRef, useState } from "react";
import { homeDict } from "@/lib/home/dict";
import type { Lang } from "@/lib/i18n";
import { ChevronIcon } from "./icons";
import { useStill } from "./motion";

const INTERVAL_MS = 4800;

export function Carousel({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const still = useStill();
    const [slide, setSlide] = useState(0);
    const [manual, setManual] = useState(false);
    const paused = useRef(false);
    const view = useRef<HTMLDivElement>(null);

    const slides = [
        {
            kicker: "JSON API",
            label: "JSON API",
            title: t.s0t,
            desc: t.s0d,
            code: (
                <>
                    app.<span className="c-fn">get</span>(<span className="c-str">{'"/hello"'}</span>, () =&gt; ({"{"}
                    {"\n  "}message: <span className="c-str">{'"Hello, Senri!"'}</span>,{"\n"}
                    {"}"}));
                </>
            ),
        },
        {
            kicker: "MIDDLEWARE",
            label: "Middleware",
            title: t.s1t,
            desc: t.s1d,
            code: (
                <>
                    app.<span className="c-fn">use</span>(<span className="c-fn">secureHeaders</span>());{"\n"}
                    app.<span className="c-fn">use</span>(<span className="c-fn">cors</span>({"{ origin: "}
                    <span className="c-str">{'"https://example.com"'}</span>
                    {" }"}));
                </>
            ),
        },
        {
            kicker: "SSE",
            label: "SSE",
            title: t.s2t,
            desc: t.s2d,
            code: (
                <>
                    <span className="c-kw">import</span> {"{ streamSSE } "}
                    <span className="c-kw">from</span> <span className="c-str">{'"@senrijs/senri/streaming"'}</span>;{"\n\n"}
                    app.<span className="c-fn">get</span>(<span className="c-str">{'"/events"'}</span>, (_, c) =&gt;{"\n  "}
                    <span className="c-fn">streamSSE</span>(c, <span className="c-kw">async</span> (s) =&gt; {"{"}
                    {"\n    "}
                    <span className="c-kw">await</span> s.<span className="c-fn">writeSSE</span>({"{ data: "}
                    <span className="c-str">{'"hi"'}</span>
                    {" }"});{"\n  "}
                    {"}"}),{"\n"});
                </>
            ),
        },
        {
            kicker: "UPLOAD",
            label: "Upload",
            title: t.s3t,
            desc: t.s3d,
            code: (
                <>
                    <span className="c-kw">import</span> {"{ multipart } "}
                    <span className="c-kw">from</span> <span className="c-str">{'"@senrijs/senri/multipart"'}</span>;{"\n\n"}
                    <span className="c-kw">for await</span> (<span className="c-kw">const</span> part <span className="c-kw">of</span>{" "}
                    <span className="c-fn">multipart</span>(c)) {"{"}
                    {"\n  "}
                    <span className="c-kw">if</span> (part.filename) <span className="c-kw">await</span> <span className="c-fn">save</span>(part.stream);{"\n"}
                    {"}"}
                </>
            ),
        },
    ];

    useEffect(() => {
        if (still) return;
        const timer = setInterval(() => {
            if (paused.current || document.hidden) return;
            setManual(false);
            setSlide((s) => (s + 1) % slides.length);
        }, INTERVAL_MS);
        return () => clearInterval(timer);
    }, [still, slides.length]);

    const go = (i: number) => {
        setManual(true);
        setSlide((i + slides.length) % slides.length);
    };

    return (
        <section className="s-sec" aria-roledescription="carousel" aria-label={t.carH}>
            <div className="s-wrap">
                <div className="s-car-head">
                    <h2 className="s-h2 s-reveal">{t.carH}</h2>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="s-round" onClick={() => go(slide - 1)} aria-label={t.prev}>
                            <ChevronIcon dir="left" size={18} />
                        </button>
                        <button type="button" className="s-round" onClick={() => go(slide + 1)} aria-label={t.next}>
                            <ChevronIcon size={18} />
                        </button>
                    </div>
                </div>
                <div
                    ref={view}
                    className="s-car-view"
                    aria-live={manual ? "polite" : "off"}
                    onMouseEnter={() => {
                        paused.current = true;
                    }}
                    onMouseLeave={() => {
                        paused.current = view.current?.contains(document.activeElement) ?? false;
                    }}
                    onFocus={() => {
                        paused.current = true;
                    }}
                    onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) paused.current = false;
                    }}
                >
                    <div className="s-car-track" style={{ transform: `translateX(-${slide * 100}%)` }}>
                        {slides.map((s, i) => (
                            <div
                                key={s.kicker}
                                className="s-slide"
                                role="group"
                                aria-roledescription="slide"
                                aria-label={t.slideOf(i + 1, slides.length)}
                                aria-hidden={i !== slide}
                                inert={i !== slide}
                            >
                                <div className="txt">
                                    <p className="kicker">{s.kicker}</p>
                                    <h3>{s.title}</h3>
                                    <p>{s.desc}</p>
                                </div>
                                <pre>{s.code}</pre>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="s-car-dots">
                    {slides.map((s, i) => (
                        <button key={s.kicker} type="button" onClick={() => go(i)} aria-label={t.showSlide(s.label)} aria-current={i === slide}>
                            <span />
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
}
