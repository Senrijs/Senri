"use client";
// リクエストの旅。黒い背景で画面が貼り付き、スクロールで5つの場面が進む
// GET /users/42 が Router → requestId → cors → auth → handler と進み、200 OK が戻ってくる
//
// 性能: React の state を変えるのは、場面が変わったとき(5回)だけ。光の位置、線の長さ、ノードの点き方、
// 帯の長さは、スクロールのたびに(1コマに1回)直接書き換える。画面の外にあるときは何もしない
// 読み上げ: 図と見出しは飾りにして、5つの場面をすべて書いた見えない一覧を置く(スクロールしなくても内容が分かる)
// 動きを止める設定: 貼り付けずに、5つの場面を縦に並べる
import { Fragment, useEffect, useRef, useState } from "react";
import { homeDict } from "@/lib/home/dict";
import { segments } from "@/lib/home/segments";
import type { Lang } from "@/lib/i18n";
import { useStill } from "./motion";

// 線の上のノード: [名前, スマホでの短い名前, 横の位置(%)]
const NODES: [string, string, number][] = [
    ["Request", "Req", 4],
    ["Router", "Route", 22],
    ["requestId", "ID", 42],
    ["cors", "CORS", 57],
    ["auth", "Auth", 72],
    ["handler", "Handle", 90],
];
const MIDDLEWARE = ["requestId", "cors", "auth"];
// 戻ってきたときの時間の帯: [名前, 左の余白(%), 長さ(%), 色]
const BARS: [string, number, number, string][] = [
    ["requestId", 0, 100, "#5A2A22"],
    ["cors", 4, 92, "#7A342A"],
    ["auth", 10, 80, "#A8463A"],
    ["handler", 16, 62, "#E3412B"],
];
const SCENES = 5;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

// スクロールの進み具合 p(0〜1)から、光の位置などを決める(モックと同じ)
function layout(p: number) {
    const seg = (a: number, b: number) => clamp((p - a) / (b - a));
    const step = Math.min(SCENES - 1, Math.floor(p * SCENES));
    let x: number;
    if (p < 0.2) x = lerp(4, 22, ease(seg(0.02, 0.18)));
    else if (p < 0.4) x = 22;
    else if (p < 0.6) x = lerp(22, 72, ease(seg(0.4, 0.58)));
    else if (p < 0.8) x = lerp(72, 90, ease(seg(0.6, 0.7)));
    else x = 90;
    const back = ease(seg(0.8, 0.96));
    const mw = seg(0.4, 0.58);
    return {
        step,
        x,
        back,
        resX: lerp(90, 4, back),
        mw: [0, 0.33, 0.66].map((s) => clamp((mw - s) / 0.34)),
        bars: seg(0.82, 0.98),
    };
}

// 場面の見出し。場面が変わるたびに作り直して、ぼやけた文字が1文字ずつ出る(home.css の .s-blur-seg)
function SceneTitle({ text, lang }: { text: string; lang: Lang }) {
    return (
        <h3 className="s-j-title" aria-hidden="true">
            {segments(text, lang).map((seg, i) =>
                /^\s+$/.test(seg) ? (
                    <span key={i}>{seg}</span>
                ) : (
                    <span key={i} className="s-blur-seg" style={{ animationDelay: `${(i * 0.04).toFixed(2)}s` }}>
                        {seg}
                    </span>
                ),
            )}
        </h3>
    );
}

// 場面ごとの、右下のパネルの中身
function Panel({ step, lang, final }: { step: number; lang: Lang; final?: boolean }) {
    const t = homeDict[lang];
    if (step === 0) {
        return (
            <div>
                <div className="dim">→ request</div>
                <div className="big">
                    <span className="g">GET</span> /users/42
                </div>
                <div className="dim" style={{ marginTop: 16 }}>
                    accept: application/json
                </div>
                <div className="dim">user-agent: curl/8.7</div>
            </div>
        );
    }
    if (step === 1) {
        return (
            <div className="col">
                <div className="dim">router</div>
                <div className="off">
                    <span className="g">GET</span>    /
                </div>
                <div className="off">
                    <span className="c">POST</span>   /users
                </div>
                <div className="hit">
                    <span className="g">GET</span>    /users/<b>:id</b>   <span className="dim">→ id = "42"</span>
                </div>
                <div className="off">
                    <span className="r">DELETE</span> /users/:id
                </div>
            </div>
        );
    }
    if (step === 2) {
        return (
            <div className="col">
                <div className="dim">middleware</div>
                {MIDDLEWARE.map((name, i) => (
                    <div key={name} className="mw" data-mw={i}>
                        <span className="name">{name}</span>
                        <span className="track">
                            <span className="fill" style={final ? { width: "100%" } : undefined} />
                        </span>
                        <span className="mark">{final ? "✓" : ""}</span>
                    </div>
                ))}
            </div>
        );
    }
    if (step === 3) {
        return (
            <div>
                <div className="dim">handler</div>
                <pre className="code">
                    app.<span className="fn">get</span>(<span className="str">"/users/:id"</span>, ({"{ id }"}) =&gt; ({"{ id }"}));
                </pre>
                <div className="dim" style={{ marginTop: 18 }}>
                    return →
                </div>
                <pre className="code plain">{'{ "id": "42" }'}</pre>
            </div>
        );
    }
    return (
        <div className="col">
            <div className="row">
                <span className="dim">← response</span>
                <span>
                    <b className="g">200</b> <span className="dim">· 3 ms</span>
                </span>
            </div>
            {BARS.map(([name, left, width, color]) => (
                <div key={name} className="bar">
                    <span className="name">{name}</span>
                    <span className="fill" data-bar={width} style={{ marginLeft: `${left}%`, width: final ? `${width}%` : 0, background: color }} />
                </div>
            ))}
            <div className="dim" style={{ marginTop: 6 }}>
                {t.jDash}
            </div>
        </div>
    );
}

// 線と、ノードと、行き来する光
function Track({ final }: { final?: boolean }) {
    return (
        <div className="s-j-track">
            <div className="line top" />
            <div className="trail" data-trail style={final ? { width: "86%" } : undefined} />
            <div className="line bottom" />
            <div className="back" data-back style={final ? { width: "86%" } : undefined} />
            {NODES.map(([label, short, x], i) => (
                <div key={label} className={final ? "node on" : i === 0 ? "node cur" : "node"} data-node={x} style={{ left: `${x}%` }}>
                    <span className="full">{label}</span>
                    <span className="short" aria-hidden="true">
                        {short}
                    </span>
                </div>
            ))}
            <div className="pkt" data-pkt style={final ? { opacity: 0 } : undefined}>
                GET /users/42
            </div>
            <div className="res" data-res style={final ? { left: "4%", opacity: 1 } : undefined}>
                200 OK
            </div>
        </div>
    );
}

export function Journey({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const still = useStill();
    const section = useRef<HTMLElement>(null);
    const [step, setStep] = useState(0);

    useEffect(() => {
        if (still) return;
        const el = section.current!;
        const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);
        let raf = 0;
        let visible = false;
        let lastStep = -1;
        const apply = () => {
            raf = 0;
            if (!visible) return;
            const rect = el.getBoundingClientRect();
            const p = clamp(-rect.top / Math.max(1, rect.height - window.innerHeight));
            const v = layout(p);
            if (v.step !== lastStep) {
                lastStep = v.step;
                setStep(v.step);
            }
            const pkt = q("[data-pkt]");
            const res = q("[data-res]");
            const trail = q("[data-trail]");
            const back = q("[data-back]");
            if (pkt) {
                pkt.style.left = `${v.x.toFixed(2)}%`;
                pkt.style.opacity = v.step < 4 ? "1" : Math.max(0, 1 - v.back * 3).toFixed(2);
            }
            if (res) {
                res.style.left = `${v.resX.toFixed(2)}%`;
                res.style.opacity = v.step === 4 ? "1" : "0";
            }
            if (trail) trail.style.width = `${Math.max(0, v.x - 4).toFixed(2)}%`;
            if (back) back.style.width = `${Math.max(0, 90 - v.resX).toFixed(2)}%`;
            // ノード: 光が近くにあるものは強く光らせ、通り過ぎたものは点いたままにする
            el.querySelectorAll<HTMLElement>("[data-node]").forEach((node) => {
                const nx = Number(node.dataset.node);
                const cur = Math.abs(v.x - nx) < 3 && v.step < 4;
                const on = v.x >= nx - 0.5 || v.step === 4;
                node.classList.toggle("cur", cur);
                node.classList.toggle("on", on && !cur);
            });
            el.querySelectorAll<HTMLElement>("[data-mw]").forEach((row) => {
                const k = v.mw[Number(row.dataset.mw)]!;
                const fill = row.querySelector<HTMLElement>(".fill");
                const mark = row.querySelector<HTMLElement>(".mark");
                if (fill) fill.style.width = `${Math.round(k * 100)}%`;
                if (mark) mark.textContent = k >= 1 ? "✓" : "";
                row.classList.toggle("on", k > 0);
            });
            el.querySelectorAll<HTMLElement>("[data-bar]").forEach((bar) => {
                bar.style.width = `${Math.round(Number(bar.dataset.bar) * v.bars)}%`;
            });
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(apply);
        };
        const io = new IntersectionObserver(([entry]) => {
            visible = entry!.isIntersecting;
            onScroll();
        });
        io.observe(el);
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        return () => {
            cancelAnimationFrame(raf);
            io.disconnect();
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, [still]);

    // 場面が変わったら、パネルの中の長さも今の位置に合わせる(作り直したばかりの要素に書き込む)
    useEffect(() => {
        if (!still) window.dispatchEvent(new Event("scroll"));
    }, [step, still]);

    const scenes = t.jCopy;
    const list = (
        <ol className="sr-only" aria-label={t.jScenes}>
            {scenes.map(([title, body], i) => (
                <li key={title}>
                    {String(i + 1).padStart(2, "0")} {title}。{body}
                </li>
            ))}
        </ol>
    );

    if (still) {
        return (
            <section id="journey" className="s-journey still" aria-labelledby="journey-title">
                <h2 id="journey-title" className="sr-only">
                    {t.jAria}
                </h2>
                {list}
                <div className="s-j-flat" aria-hidden="true">
                    <div className="s-j-viz">
                        <Track final />
                    </div>
                    {scenes.map(([title, body], i) => (
                        <Fragment key={title}>
                            <div className="s-j-scene">
                                <div className="s-j-copy">
                                    <p className="s-j-no">
                                        {String(i + 1).padStart(2, "0")} — {String(SCENES).padStart(2, "0")}
                                    </p>
                                    <h3 className="s-j-title">{title}</h3>
                                    <p className="s-j-body">{body}</p>
                                </div>
                                <div className="s-j-panel">
                                    <Panel step={i} lang={lang} final />
                                </div>
                            </div>
                        </Fragment>
                    ))}
                </div>
            </section>
        );
    }

    const [title, body] = scenes[step]!;
    return (
        <section ref={section} id="journey" className="s-journey" aria-labelledby="journey-title">
            <h2 id="journey-title" className="sr-only">
                {t.jAria}
            </h2>
            {list}
            <div className="s-j-stage" aria-hidden="true">
                <div className="s-j-copy">
                    <ol className="s-j-steps">
                        {scenes.map((_, i) => (
                            <li key={i} className={i === step ? "cur" : i < step ? "done" : undefined} />
                        ))}
                    </ol>
                    <p className="s-j-no">
                        {String(step + 1).padStart(2, "0")} — {String(SCENES).padStart(2, "0")}
                    </p>
                    <SceneTitle key={step} text={title} lang={lang} />
                    <p className="s-j-body">{body}</p>
                </div>
                <div className="s-j-viz" role="img" aria-label={t.jStage + title}>
                    <Track />
                    <div className="s-j-panel">
                        <div key={step} className="s-j-in">
                            <Panel step={step} lang={lang} />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
