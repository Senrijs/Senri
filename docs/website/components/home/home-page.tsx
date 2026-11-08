// トップページ。docs/design/top-page.dc.html を部品にしたもの
// 動かない部分はここで HTML にし、動く部分(パーティクル、コピー、デモ、CLI、カード、カルーセル)だけをクライアントの部品にする
import Link from "next/link";
import type { CSSProperties } from "react";
import data from "@/lib/home/generated.json";
import { homeDict } from "@/lib/home/dict";
import type { HomeData } from "@/lib/home/types";
import { type Lang, localePath } from "@/lib/i18n";
import { githubUrl } from "@/lib/shared";
import { Carousel } from "./carousel";
import { CliLog } from "./cli-log";
import { Demo } from "./demo";
import { Features } from "./features";
import { ChevronIcon, DownloadIcon, StarIcon } from "./icons";
import { Install } from "./install";
import { Particles } from "./particles";

const home = data as HomeData;

export function HomePage({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const docs = localePath(lang, "/docs");
    const boom = home.playground[lang].find((r) => r.error)!.error!;
    return (
        <main id="main">
            <Hero lang={lang} docs={docs} />
            <Marquee lang={lang} />
            <Numbers lang={lang} />

            <section className="s-sec" style={{ overflow: "hidden" }}>
                <div className="s-glow" style={{ right: "-6%", top: "10%", width: 720, height: 620 }} aria-hidden="true" />
                <div className="s-wrap s-split">
                    <h2 className="s-h2 lg s-reveal">
                        {t.cliA}
                        <br />
                        {t.cliB}
                    </h2>
                    <CliLog banner={home.cli.banner[lang]} logs={home.cli.logs} label={t.cliAria} />
                </div>
            </section>

            <Layers lang={lang} />
            <RouteTree lang={lang} />

            <section className="s-sec s-alt" style={{ overflow: "hidden" }}>
                <div className="s-glow" style={{ left: "-8%", top: "18%", width: 680, height: 680 }} aria-hidden="true" />
                <div
                    className="s-glow"
                    style={{ right: "-6%", bottom: "-12%", width: 600, height: 600, background: "radial-gradient(closest-side, rgba(255,150,80,0.2), rgba(255,150,80,0))" }}
                    aria-hidden="true"
                />
                <div className="s-wrap">
                    <h2 className="s-h2 lg s-reveal">{t.featH}</h2>
                    <Features lang={lang} error={boom} />
                </div>
            </section>

            <Carousel lang={lang} />
            <GitGraph lang={lang} />
            <Timeline lang={lang} />

            <section className="s-cta">
                <p>{t.proverb}</p>
                <h2 className="s-reveal">{t.ctaH}</h2>
                <div className="row">
                    <Link className="s-btn s-btn-solid" href={docs}>
                        {t.docs}
                    </Link>
                    <Link className="s-btn s-btn-line" href={githubUrl}>
                        GitHub
                    </Link>
                </div>
            </section>
        </main>
    );
}

function Hero({ lang, docs }: { lang: Lang; docs: string }) {
    const t = homeDict[lang];
    const { version, stats } = home;
    // バッジの説明は、辞書を書いたときのバージョンと同じときだけ付ける
    const badge = t.badgeVersion === version ? `v${version} — ${t.badge}` : `v${version} ${t.badgeRelease}`;
    const fmt = (n: number) => n.toLocaleString("en-US");
    return (
        <section className="s-hero">
            <Particles />
            <div className="s-glow" style={{ left: "50%", bottom: -160, width: 1000, height: 520, transform: "translateX(-50%)" }} aria-hidden="true" />
            <Link href="#timeline" className="s-badge s-up">
                <span className="s-beacon" style={{ background: "var(--green)" }} aria-hidden="true" />
                {badge}
            </Link>
            <h1 className="s-h1 s-up d1">
                {t.h1a}
                <br />
                {t.h1b}
            </h1>
            <p className="s-lead s-up d2">{t.heroP}</p>
            <Install lang={lang} docsHref={docs} />
            {stats.stars !== null || stats.downloads !== null ? (
                <div className="s-stats s-up d3">
                    {stats.stars !== null ? (
                        <a className="s-link" href={`${githubUrl}/stargazers`} aria-label={`${t.stars}: ${fmt(stats.stars)}`}>
                            <StarIcon />
                            <b>{fmt(stats.stars)}</b> GitHub
                        </a>
                    ) : null}
                    {stats.stars !== null && stats.downloads !== null ? <span aria-hidden="true">·</span> : null}
                    {stats.downloads !== null ? (
                        <a className="s-link" href="https://www.npmjs.com/package/@senrijs/senri" aria-label={`${t.dl}: ${fmt(stats.downloads)}`}>
                            <DownloadIcon />
                            <b>{fmt(stats.downloads)}</b> {t.perWeek}
                        </a>
                    ) : null}
                </div>
            ) : null}
            <Demo lang={lang} recordings={home.playground[lang]} port={home.port} />
        </section>
    );
}

function Marquee({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const items = ["Bun", "Node.js", "Deno", "Cloudflare Workers", "Browser"];
    const row = (hidden: boolean) => (
        <>
            {items.map((name) => (
                <span key={name + hidden} aria-hidden={hidden || undefined}>
                    {name}
                </span>
            ))}
            <span className="std" aria-hidden={hidden || undefined}>
                ● Web Standard
            </span>
        </>
    );
    return (
        <section className="s-marquee-sec" aria-label={t.runtimes}>
            <div className="s-marquee">
                {row(false)}
                {row(true)}
            </div>
        </section>
    );
}

function Numbers({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    // 16 KB: bun run size の「hi」のアプリ(bun build、minify)。テスト: bun test の件数。リリースのときに見直す
    const items = [
        ["5", t.nRt],
        ["16 KB", t.nSize],
        ["1,484", t.nTests],
        ["MIT", t.nLic],
    ];
    return (
        <section className="s-numbers">
            <div className="s-grid4">
                {items.map(([value, label]) => (
                    <div key={label} className="s-number">
                        <b>{value}</b>
                        <span>{label}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function Layers({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    return (
        <section className="s-sec s-alt">
            <div className="s-wrap s-split">
                <h2 className="s-h2 s-reveal">
                    {t.layA}
                    <br />
                    {t.layB}
                </h2>
                <div className="s-layers" role="img" aria-label={t.layAria}>
                    <div className="ippo">
                        Ippo <span>· {t.dev}</span>
                    </div>
                    <div className="stem" />
                    <div className="runtime">
                        <span className="tag">RUNTIME</span>
                        <span className="tag right s-hide-sm">Bun / Node.js / Deno / Workers</span>
                        <div className="flow">
                            <span className="end">Request</span>
                            <div className="senri">
                                <span className="tag">SENRI</span>
                                <div className="mws">
                                    <span>requestId</span>
                                    <span>cors</span>
                                    <span>auth</span>
                                    <span className="handler">handler</span>
                                    <i className="packet" aria-hidden="true" />
                                </div>
                            </div>
                            <span className="end">Response</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function RouteTree({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    // 線: [left, top, width, height, 選ばれた道か]
    const lines: [number, number, number, number, boolean?][] = [
        [200, 189, 48, 2],
        [247, 94, 2, 192],
        [248, 189, 48, 2],
        [248, 285, 48, 2],
        [511, 46, 2, 72],
        [512, 45, 48, 2],
        [464, 189, 96, 2],
        [464, 285, 48, 2],
        [511, 262, 2, 72],
        [512, 261, 48, 2],
        [512, 333, 48, 2],
        [200, 189, 49, 2, true],
        [247, 93, 2, 98, true],
        [247, 93, 49, 2, true],
        [464, 93, 49, 2, true],
        [511, 93, 2, 26, true],
        [511, 117, 49, 2, true],
    ];
    const box = (left: number, top: number, width: number): CSSProperties => ({ left, top, width });
    return (
        <section className="s-sec">
            <div className="s-wrap">
                <h2 className="s-h2 s-reveal">
                    {t.rtA}
                    <br />
                    {t.rtB}
                </h2>
                <div className="s-tree-box" role="img" aria-label={t.rtAria}>
                    <div className="s-tree">
                        {lines.map(([left, top, width, height, on], i) => (
                            <div key={i} className={on ? "ln on" : "ln"} style={{ left, top, width, height }} />
                        ))}
                        <div className="node center app" style={box(64, 166, 136)}>
                            app
                        </div>
                        <div className="node center on" style={box(296, 70, 168)}>
                            /users
                        </div>
                        <div className="node center" style={box(296, 166, 168)}>
                            /posts
                        </div>
                        <div className="node center" style={box(296, 262, 168)}>
                            /api/*
                        </div>
                        <div className="node leaf" style={box(560, 22, 236)}>
                            <span>
                                <span className="m-get">GET</span> /users
                            </span>
                        </div>
                        <div className="node leaf on match" style={box(560, 94, 236)}>
                            <span>
                                <span className="m-get">GET</span> /users/<b className="s-tone-err">:id</b>
                            </span>
                        </div>
                        <div className="node leaf" style={box(560, 166, 236)}>
                            <span>
                                <span className="m-post">POST</span> /posts
                            </span>
                        </div>
                        <div className="node leaf" style={box(560, 238, 236)}>
                            <span>
                                <span style={{ color: "var(--muted)" }}>use</span> rateLimit(…)
                            </span>
                        </div>
                        <div className="node leaf" style={box(560, 310, 236)}>
                            <span>
                                <span className="m-get">GET</span> /api/health
                            </span>
                        </div>
                        <div className="req">GET /users/42</div>
                    </div>
                </div>
            </div>
        </section>
    );
}

// main から機能ごとにブランチを切り、マージしてリリースのタグを付ける流れ(#61 から #68 まで。ブランチ名は本物)
function GitGraph({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const accent = "var(--accent)";
    const branches: { d: string; color: string }[] = [
        { d: "M100 150 C130 150 120 70 160 70 H220 C260 70 250 150 280 150", color: accent },
        { d: "M360 150 C390 150 380 230 410 230 H420 C455 230 450 150 480 150", color: "#3B82F6" },
        { d: "M500 150 C525 150 515 70 545 70 H550 C580 70 575 150 600 150", color: "#22A06B" },
        { d: "M660 150 C690 150 680 230 720 230 H780 C820 230 810 150 840 150", color: "#9B6BF2" },
        { d: "M900 150 C925 150 915 70 950 70 H960 C990 70 985 150 1000 150", color: "#F08A24" },
    ];
    const commits: [number, number, string][] = [
        [160, 70, accent],
        [220, 70, accent],
        [420, 230, "#3B82F6"],
        [550, 70, "#22A06B"],
        [720, 230, "#9B6BF2"],
        [780, 230, "#9B6BF2"],
        [960, 70, "#F08A24"],
    ];
    const merges: [number, string][] = [
        [280, accent],
        [480, "#3B82F6"],
        [600, "#22A06B"],
        [840, "#9B6BF2"],
        [1000, "#F08A24"],
    ];
    const tags: [number, string][] = [
        [60, "v0.2.15"],
        [330, "v0.2.16"],
        [640, "v0.2.17"],
        [880, "v0.2.18"],
    ];
    const prs: [number, string, "middle" | "start"][] = [
        [280, "#61", "middle"],
        [492, "#63", "start"],
        [600, "#65", "middle"],
        [852, "#66", "start"],
        [1000, "#68", "middle"],
    ];
    const names: [number, number, string][] = [
        [160, 50, "feat/i18n-dev-and-sse-heartbeat"],
        [410, 258, "fix/english-runtime-messages"],
        [530, 50, "fix/flaky-tests"],
        [700, 258, "feat/multipart-stream"],
        [930, 50, "feat/docs-website"],
    ];
    return (
        <section className="s-sec" style={{ paddingBottom: 120 }}>
            <div className="s-wrap">
                <div className="s-car-head" style={{ gap: "16px 48px" }}>
                    <h2 className="s-h2 s-reveal">
                        {t.gitA}
                        <br />
                        {t.gitB}
                    </h2>
                    <a className="s-link" href={`${githubUrl}/pulls?q=is%3Apr+is%3Amerged`} style={{ fontSize: 14, color: "var(--muted)" }}>
                        {t.gitLink}
                    </a>
                </div>
                <div className="s-git-box s-glass">
                    <svg className="s-git" role="img" aria-label={t.gitAria} viewBox="0 0 1120 300">
                        <path className="s-draw" d="M40 150 H1060" fill="none" style={{ stroke: "var(--fg)", strokeWidth: 2.5 }} />
                        {branches.map((b) => (
                            <path key={b.d} className="s-draw" d={b.d} fill="none" style={{ stroke: b.color, strokeWidth: 2.5 }} />
                        ))}
                        <g className="s-cm">
                            {commits.map(([cx, cy, color]) => (
                                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6" style={{ fill: "var(--bg)", stroke: color, strokeWidth: 2.5 }} />
                            ))}
                            {tags.map(([x]) => (
                                <circle key={x} cx={x} cy="150" r="6" style={{ fill: "var(--bg)", stroke: "var(--fg)", strokeWidth: 2.5 }} />
                            ))}
                            {merges.map(([x, color]) => (
                                <circle key={x} cx={x} cy="150" r="7" style={{ fill: color }} />
                            ))}
                            {tags.map(([x, label]) => (
                                <text key={label} x={x} y="126" textAnchor="middle" style={{ fill: "var(--muted)" }}>
                                    {label}
                                </text>
                            ))}
                            {prs.map(([x, label, anchor]) => (
                                <text key={label} x={x} y="180" textAnchor={anchor} style={{ fill: "var(--fg-2)" }}>
                                    {label}
                                </text>
                            ))}
                            {names.map(([x, y, label]) => (
                                <text key={label} x={x} y={y} style={{ fill: "var(--muted)" }}>
                                    {label}
                                </text>
                            ))}
                        </g>
                        <circle className="s-gping" cx="1060" cy="150" r="7" style={{ fill: accent }} />
                        <circle cx="1060" cy="150" r="7" style={{ fill: accent }} />
                        <text x="1060" y="126" textAnchor="middle" style={{ fill: "var(--fg)", fontWeight: 700 }}>
                            main
                        </text>
                    </svg>
                </div>
            </div>
        </section>
    );
}

function Timeline({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const date = (iso: string) => <time dateTime={iso}>{iso}</time>;
    return (
        <section id="timeline" className="s-sec s-alt" aria-labelledby="tl-title" style={{ overflowX: "clip" }}>
            <div className="s-glow" style={{ right: "-10%", top: "30%", width: 700, height: 700 }} aria-hidden="true" />
            <div className="s-wrap" style={{ display: "flex", flexWrap: "wrap", gap: "48px 64px", alignItems: "flex-start" }}>
                <div className="s-tl-side">
                    <h2 id="tl-title" className="s-h2 s-reveal">
                        {t.tlA}
                        <br />
                        {t.tlB}
                    </h2>
                    <a className="s-link" href={`${githubUrl}/releases`} style={{ display: "inline-block", marginTop: 24, fontSize: 14, color: "var(--muted)" }}>
                        {t.tlAll}
                    </a>
                </div>
                <ol className="s-tl">
                    <li>
                        <span className="s-tl-dot before" aria-hidden="true" />
                        <details>
                            <summary>
                                <ChevronIcon className="s-chev" size={14} strokeWidth={2.2} />
                                {t.tlBefore}
                            </summary>
                            <p>
                                {t.tlB1}
                                <a className="s-link" href={`${githubUrl}/blob/main/CHANGELOG.md`}>
                                    CHANGELOG
                                </a>
                                {t.tlB2}
                            </p>
                        </details>
                    </li>
                    <Entry version={<>v0.2.10 – v0.2.11 · {date("2026-11-06")}</>} title={t.e1t} desc={t.e1d} />
                    <Entry version={<>v0.2.16 · {date("2026-11-07")}</>} title={t.e2t} desc={t.e2d} />
                    <Entry version={<>v0.2.18 · {date("2026-11-08")}</>} title={t.e3t} desc="multipart(c)" code />
                    <li className="s-tl-item" aria-current="step">
                        <span className="s-tl-now" aria-hidden="true">
                            <span className="s-beacon" />
                        </span>
                        <div className="s-tl-card s-glass now">
                            <span className="v">
                                {date("2026-11-08")}
                                <span className="tag">{t.now}</span>
                            </span>
                            <span className="t">{t.e4t}</span>
                            <span className="d">{t.e4d}</span>
                        </div>
                    </li>
                    <li className="s-tl-item">
                        <span className="s-tl-dot plan" aria-hidden="true" />
                        <div className="s-tl-card plan">
                            <span className="v">v0.3.0 · {t.planned}</span>
                            <span className="t">{t.e5t}</span>
                        </div>
                    </li>
                    <li className="s-tl-item">
                        <span className="s-tl-dot plan" aria-hidden="true" />
                        <div className="s-tl-card plan">
                            <span className="v">Ippo · {t.planned}</span>
                            <span className="t">{t.e6t}</span>
                        </div>
                    </li>
                </ol>
            </div>
        </section>
    );
}

function Entry({ version, title, desc, code }: { version: React.ReactNode; title: string; desc: string; code?: boolean }) {
    return (
        <li className="s-tl-item">
            <span className="s-tl-dot" aria-hidden="true" />
            <div className="s-tl-card s-glass">
                <span className="v">{version}</span>
                <span className="t">{title}</span>
                <span className={code ? "d code" : "d"}>{desc}</span>
            </div>
        </li>
    );
}
