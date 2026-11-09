// トップページ。docs/design/top-page.dc.html を部品にしたもの
// 動かない部分はここで HTML にし、動く部分(パーティクル、コピー、デモ、CLI、カード、カルーセル)だけをクライアントの部品にする
import Link from "next/link";
import { type CSSProperties, Fragment } from "react";
import data from "@/lib/home/generated.json";
import { homeDict } from "@/lib/home/dict";
import { segments } from "@/lib/home/segments";
import type { HomeData } from "@/lib/home/types";
import { type Lang, localePath } from "@/lib/i18n";
import { githubUrl } from "@/lib/shared";
import { AnimIcon } from "./anim-icon";
import { Carousel } from "./carousel";
import { CountUp } from "./count-up";
import { CliLog } from "./cli-log";
import { Demo } from "./demo";
import { Features } from "./features";
import { Gallery } from "./gallery";
import { HeroStage } from "./hero-stage";
import { ChevronIcon, DownloadIcon, StarIcon } from "./icons";
import { Horizon } from "./horizon";
import { Install } from "./install";
import { Journey } from "./journey";
import { Particles } from "./particles";
import { BlurHeading } from "./text-reveal";

const home = data as HomeData;

export function HomePage({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const docs = localePath(lang, "/docs");
    const boom = home.playground[lang].find((r) => r.error)!.error!;
    return (
        <main id="main">
            <Hero lang={lang} docs={docs} />
            <Journey lang={lang} />

            <section className="s-sec" aria-labelledby="demo-title">
                <div className="s-wrap">
                    <BlurHeading id="demo-title" className="s-h2 s-h2-big" lang={lang} big="TRY IT" lines={[t.demoA, t.demoB]} />
                    <Demo lang={lang} recordings={home.playground[lang]} port={home.port} />
                </div>
            </section>

            <Marquee lang={lang} />
            <Numbers lang={lang} />
            <RuntimeTable lang={lang} />

            <section className="s-sec" style={{ overflow: "hidden" }}>
                <div className="s-glow" style={{ right: "-6%", top: "10%", width: 720, height: 620 }} aria-hidden="true" />
                <div className="s-wrap s-split">
                    <BlurHeading className="s-h2 s-h2-big" lang={lang} big="START" lines={[t.cliA, t.cliB]} />
                    <CliLog banner={home.cli.banner[lang]} logs={home.cli.logs} label={t.cliAria} />
                </div>
            </section>

            <Layers lang={lang} />
            <RouteTree lang={lang} />

            <Gallery heading={<BlurHeading id="feat-title" className="s-h2 s-h2-big" lang={lang} big="FEATURES" lines={[t.featH]} />}>
                <Features lang={lang} error={boom} />
            </Gallery>

            <Carousel lang={lang} />
            <Timeline lang={lang} />

            <section className="s-cta">
                <Horizon />
                <div className="s-cta-fade" aria-hidden="true" />
                <p>{t.proverb}</p>
                <BlurHeading lang={lang} lines={[t.ctaH]} />
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
            <HeroStage cue={t.cue}>
            <Particles />
            <div className="s-grain" aria-hidden="true" />
            <div className="s-glow" style={{ left: "50%", bottom: -160, width: 1000, height: 520, transform: "translateX(-50%)" }} aria-hidden="true" />
            <div className="s-hero-inner" data-hero-inner>
            <Link href="#timeline" className="s-badge s-lg s-up">
                <span className="s-beacon" style={{ background: "var(--green)" }} aria-hidden="true" />
                {badge}
            </Link>
            <HeroTitle lang={lang} lines={[t.h1a, t.h1b]} />
            <p className="s-lead s-up d2">{t.heroP}</p>
            <Install lang={lang} docsHref={docs} />
            {stats.stars !== null || stats.downloads !== null ? (
                <div className="s-stats s-up d3">
                    {stats.stars !== null ? (
                        <a className="s-link" href={`${githubUrl}/stargazers`} aria-label={`${t.stars}: ${fmt(stats.stars)}`}>
                            <AnimIcon name="star" size={14} interaction="hover" fallback={<StarIcon />} />
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
            </div>
            </HeroStage>
        </section>
    );
}

// ヒーローの見出し。ぼやけた文字が下からふわっと出る(日本語は1文字ずつ、英語は1単語ずつ)
// いちばん大きな表示なので、JavaScript を待たずに CSS だけで動かす(home.css の .s-blur-seg)
function HeroTitle({ lang, lines }: { lang: Lang; lines: string[] }) {
    // 日英とも 40ms ずつ(components/home/text-reveal.tsx と同じ決まり)
    const step = 0.04;
    let i = 0;
    return (
        <h1 className="s-h1">
            <span className="sr-only">{lines.join(lang === "ja" ? "" : " ")}</span>
            <span aria-hidden="true">
                {lines.map((line, n) => (
                    <span key={n}>
                        {n > 0 ? <br /> : null}
                        {segments(line, lang).map((seg) =>
                            /^\s+$/.test(seg) ? (
                                <span key={i++}>{seg}</span>
                            ) : (
                                <span key={i} className="s-blur-seg" style={{ animationDelay: `${(i++ * step).toFixed(3)}s` }}>
                                    {seg}
                                </span>
                            ),
                        )}
                    </span>
                ))}
            </span>
        </h1>
    );
}

// ランタイムの帯。継ぎ目なくループさせる:
// - 同じ中身の箱を2つ並べ、外側を translateX(0) → translateX(-50%)(ちょうど箱1つ分)で動かす
// - 間隔は gap ではなく各項目の右の余白で作る(最後の項目にも付けて、箱の終わりと次の箱の始まりも同じ間隔に)
// - 箱1つが広い画面(約 4000px まで)より長くなるよう、箱の中で項目を 4 回繰り返す。速さは前と同じ(1 回 28 秒 × 4)
// - 読み上げは最初の1回分だけ。繰り返した分と2つ目の箱は aria-hidden
const MARQUEE_REPEAT = 4;

function Marquee({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const items = ["Bun", "Node.js", "Deno", "Cloudflare Workers", "Browser"];
    const set = (key: string, hidden: boolean) => (
        <Fragment key={key}>
            {items.map((name) => (
                <span key={name} aria-hidden={hidden || undefined}>
                    {name}
                </span>
            ))}
            <span className="std" aria-hidden={hidden || undefined}>
                ● Web Standard
            </span>
        </Fragment>
    );
    const box = (n: number) => (
        <div className="s-marquee-box" aria-hidden={n > 0 || undefined}>
            {Array.from({ length: MARQUEE_REPEAT }, (_, i) => set(String(i), n > 0 || i > 0))}
        </div>
    );
    return (
        <section className="s-marquee-sec" aria-label={t.runtimes}>
            <div className="s-marquee" style={{ animationDuration: `${28 * MARQUEE_REPEAT}s` }}>
                {box(0)}
                {box(1)}
            </div>
        </section>
    );
}

function Numbers({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    // 16 KB: bun run size の「hi」のアプリ(bun build、minify)。テスト: bun test の件数。リリースのときに見直す
    // 数える意味があるもの(16 と 1,484)だけ、画面に入ったときに数える
    const items: [React.ReactNode, string][] = [
        ["5", t.nRt],
        [<CountUp key="size" value={16} suffix=" KB" />, t.nSize],
        [<CountUp key="tests" value={1484} />, t.nTests],
        ["MIT", t.nLic],
    ];
    return (
        <section className="s-numbers">
            <div className="s-grid4">
                {items.map(([value, label]) => (
                    <div key={label} className="s-number">
                        {typeof value === "string" ? <b>{value}</b> : value}
                        <span>{label}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

// どのランタイムでも同じコード。起動の書き方は README とテンプレートのとおり(Browser は Service Worker の fetch イベントで app.fetch)
function RuntimeTable({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const rows: [string, string, string | null, string][] = [
        ["Bun", "serve(app)", null, "/docs/runtimes/bun"],
        ["Node.js", "serve(app)", null, "/docs/runtimes/node"],
        ["Deno", "serve(app)", null, "/docs/runtimes/deno"],
        ["Cloudflare Workers", "export default app", null, "/docs/runtimes/cloudflare-workers"],
        ["Browser", "app.fetch(request)", "Service Worker", "/docs/runtimes/browser"],
    ];
    return (
        <section className="s-sec s-rt-sec" aria-labelledby="rt-title">
            <div className="s-wrap">
                <BlurHeading id="rt-title" className="s-h2 s-h2-big" lang={lang} big="RUNTIMES" lines={[t.rtTable]} />
                <table className="s-rt">
                    <caption className="sr-only">{t.rtTable}</caption>
                    <thead>
                        <tr>
                            <th scope="col">NO.</th>
                            <th scope="col">RUNTIME</th>
                            <th scope="col" className="s-rt-code">
                                START
                            </th>
                            <th aria-hidden="true" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(([name, code, note, href], i) => (
                            <tr key={name}>
                                <td className="no">{String(i + 1).padStart(2, "0")}</td>
                                <th scope="row">
                                    <Link href={localePath(lang, href)} className="name">
                                        {name}
                                        {note ? <span className="note"> {note}</span> : null}
                                    </Link>
                                </th>
                                <td className="s-rt-code">
                                    <code>{code}</code>
                                </td>
                                <td className="arrow" aria-hidden="true">
                                    →
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function Layers({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    return (
        <section className="s-sec s-alt">
            <div className="s-wrap s-split">
                <BlurHeading className="s-h2 s-h2-big" lang={lang} big="LAYERS" lines={[t.layA, t.layB]} />
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
                <BlurHeading className="s-h2 s-h2-big" lang={lang} big="ROUTING" lines={[t.rtA, t.rtB]} />
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

function Timeline({ lang }: { lang: Lang }) {
    const t = homeDict[lang];
    const date = (iso: string) => <time dateTime={iso}>{iso}</time>;
    return (
        <section id="timeline" className="s-sec s-alt" aria-labelledby="tl-title" style={{ overflowX: "clip" }}>
            <div className="s-glow" style={{ right: "-10%", top: "30%", width: 700, height: 700 }} aria-hidden="true" />
            <div className="s-wrap" style={{ display: "flex", flexWrap: "wrap", gap: "48px 64px", alignItems: "flex-start" }}>
                <div className="s-tl-side">
                    <BlurHeading id="tl-title" className="s-h2 s-h2-big" lang={lang} big="TIMELINE" lines={[t.tlA, t.tlB]} />
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
