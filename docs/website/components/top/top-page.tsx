// グリッド版のトップページ。docs/design/GridFull.dc.html を部品にしたもの
// 動かない部分はここで HTML にし、動く部分(コピー、ストーリースクロール、プレイグラウンド、CLI、ダイアログ、カルーセル、Canvas)だけをクライアントの部品にする
import type { ReactNode } from "react";
import data from "@/lib/home/generated.json";
import { gridDict } from "@/lib/home/grid-dict";
import type { HomeData } from "@/lib/home/types";
import type { Lang } from "@/lib/i18n";
import { githubUrl } from "@/lib/shared";
import { Cli } from "./cli";
import { Features } from "./features";
import { Install } from "./install";
import { Journey } from "./journey";
import { Patterns } from "./patterns";
import { Plus } from "./plus";
import { Reveal } from "./reveal";
import { Dots } from "./dots";
import { Story } from "./story";
import { TryIt } from "./try-it";

const home = data as HomeData;

// 数字の帯。リリースのときに見直す
// - 大きさ: リポジトリで bun run size をしたときの「hi」のアプリ(bun build、minify あり)の gzip 後
// - テスト: リポジトリで bun test をしたときの件数
// - 依存: ルートの package.json の dependencies の数
const SIZE_GZIP = "6.9 KB";
const TESTS = 1881;
const DEPENDENCIES = 0;

export function TopPage({ lang }: { lang: Lang }) {
    const t = gridDict[lang];
    const boom = home.playground[lang].find((r) => r.error)!.error!;
    return (
        <main id="main">
            <Hero lang={lang} />
            <section className="row" aria-label={lang === "ja" ? "対応ランタイム" : "Supported runtimes"}>
                <ul className="box grid rtband" style={{ margin: "0 auto", padding: 0, listStyle: "none" }}>
                    <Plus />
                    {["Bun", "Node.js", "Deno", "Workers", "Browser"].map((name, i) => (
                        <li key={name} className="cell">
                            <span>{String(i + 1).padStart(2, "0")}</span>
                            {name}
                        </li>
                    ))}
                </ul>
            </section>
            <section className="row" aria-label={lang === "ja" ? "数字" : "Numbers"}>
                <div className="box grid nums">
                    <Plus />
                    {(
                        [
                            ["5", t.nRuntimes],
                            [SIZE_GZIP, t.nSize],
                            [String(DEPENDENCIES), t.nDeps],
                            [TESTS.toLocaleString("en-US"), t.nTests],
                        ] as const
                    ).map(([value, label]) => (
                        <div key={label} className="cell">
                            <b>{value}</b>
                            <span>{label}</span>
                        </div>
                    ))}
                </div>
            </section>

            <div className="dk">
                <Head big="JOURNEY" lead={t.jLead} />
                <Journey lang={lang} />
            </div>

            <Head id="try-title" big="TRY IT" lead={t.tryLead} />
            <TryIt lang={lang} recordings={home.playground[lang]} port={home.port} />

            <Head big="RUNTIMES" lead={t.rtLead} />
            <Runtimes lang={lang} />

            <section className="row" aria-labelledby="cli-title">
                <div className="box grid two">
                    <Plus />
                    <div className="cell">
                        <Reveal as="p" className="big md" decorative>
                            CLI
                        </Reveal>
                        <Reveal id="cli-title" label={t.cliH.join(lang === "ja" ? "" : " ")}>
                            {t.cliH[0]}
                            <br />
                            {t.cliH[1]}
                        </Reveal>
                        <p>{t.cliP}</p>
                    </div>
                    <div className="cell cliw">
                        <Cli lang={lang} banner={home.cli.banner[lang]} logs={home.cli.logs} label={t.cliAria} booting={t.cliBoot} />
                    </div>
                </div>
            </section>

            <Layers lang={lang} />
            <Routing lang={lang} />

            <Head id="feat-title" big="FEATURES" lead={t.featLead} />
            <Features lang={lang} error={boom} />

            <Patterns lang={lang} codes={PATTERN_CODES} />

            <Timeline lang={lang} />

            <section className="row" id="start" aria-labelledby="start-title">
                <div className="box cta">
                    <Dots />
                    <Plus />
                    <Reveal id="start-title">{t.ctaH}</Reveal>
                    <p className="sub">{t.proverb}</p>
                    <Install lang={lang} />
                </div>
            </section>
        </main>
    );
}

function Head({ id, big, lead }: { id?: string; big: string; lead: string }) {
    return (
        <section className="row">
            <div className="box">
                <Plus />
                <div className="head">
                    <Reveal id={id} className="big" label={`${big} — ${lead}`}>
                        {big}
                    </Reveal>
                    <p aria-hidden="true">{lead}</p>
                </div>
            </div>
        </section>
    );
}

function Hero({ lang }: { lang: Lang }) {
    const t = gridDict[lang];
    const { version, stats } = home;
    const badge = version.startsWith(`${t.badgeVersion}.`) ? `v${version} — ${t.badge}` : `v${version}`;
    const fmt = (n: number) => n.toLocaleString("en-US");
    return (
        <section className="row">
            <div className="box grid hero">
                <Plus />
                <div className="cell">
                    <a className="tag" href="#timeline">
                        <i aria-hidden="true" />
                        {badge}
                    </a>
                    <Reveal as="h1" label={t.h1.join(lang === "ja" ? "" : " ")}>
                        <span>{t.h1[0]}</span>
                        <span>{t.h1[1]}</span>
                    </Reveal>
                    <p className="lead">{t.lead}</p>
                    <Install lang={lang} />
                    {stats.stars !== null || stats.downloads !== null ? (
                        <div className="stats">
                            {stats.stars !== null ? (
                                <a href={`${githubUrl}/stargazers`}>
                                    <b>★ {fmt(stats.stars)}</b>GitHub
                                </a>
                            ) : null}
                            {stats.downloads !== null ? (
                                <a href="https://www.npmjs.com/package/@senrijs/senri">
                                    <b>{fmt(stats.downloads)}</b>
                                    {t.perWeek}
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                <div className="cell" aria-hidden="true">
                    <div className="win ed">
                        <Bar title="my-app — Visual Studio Code" />
                        <div className="ebody">
                            <Act />
                            <div className="emain">
                                <div className="tabs">
                                    <span className="on">src/index.ts</span>
                                    <span>package.json</span>
                                </div>
                                <Code
                                    lines={[
                                        <>
                                            <span className="k">import</span> {"{ createApp }"} <span className="k">from</span> <span className="s">&quot;@senrijs/senri&quot;</span>;
                                        </>,
                                        <>
                                            <span className="k">import</span> {"{ serve }"} <span className="k">from</span> <span className="s">&quot;@senrijs/senri/serve&quot;</span>;
                                        </>,
                                        "",
                                        <>
                                            <span className="k">const</span> app = <span className="fn">createApp</span>();
                                        </>,
                                        "",
                                        <>
                                            app.<span className="fn">get</span>(<span className="s">&quot;/users/:id&quot;</span>, ({"{ id }"}) =&gt; ({"{ id }"}));
                                        </>,
                                        <span className="c">{"//                           ^? id: string"}</span>,
                                        "",
                                        <>
                                            <span className="fn">serve</span>(app);
                                        </>,
                                    ]}
                                />
                                <div className="term">
                                    <div className="ttabs">
                                        <span className="on">TERMINAL</span>
                                        <span>PROBLEMS</span>
                                        <span>OUTPUT</span>
                                    </div>
                                    <div className="tbody">
                                        <div>
                                            <span className="wd">$</span> bun run dev
                                        </div>
                                        <div>
                                            {"  "}
                                            <span className="sn">senr</span>
                                            <span className="sl">/</span>
                                            {"  "}
                                            <span className="gr">ready</span>
                                            {"  "}http://localhost:{home.port}
                                        </div>
                                        <div>
                                            <span className="wd">$</span> curl localhost:{home.port}/users/42
                                        </div>
                                        <div>{'{"id":"42"}'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function Bar({ title }: { title: string }) {
    return (
        <div className="tbar">
            <i />
            <i />
            <i />
            <span className="ttl">{title}</span>
        </div>
    );
}

function Act() {
    return (
        <div className="act">
            <b />
            <b />
            <b />
            <b />
        </div>
    );
}

function Code({ lines }: { lines: ReactNode[] }) {
    return (
        <div className="code">
            <div className="gut">
                {lines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                ))}
            </div>
            <div className="src">
                {lines.map((l, i) => (
                    <div key={i}>{l === "" ? " " : l}</div>
                ))}
            </div>
        </div>
    );
}

// --- RUNTIMES: app.ts は変わらず、起動のファイルだけが変わる。書き方は create-senri の雛形と、ドキュメントのランタイムのページのとおり ---

type Runtime = { name: string; file: string; entry: ReactNode; term: string; lines: ReactNode[] };

const R = (s: string) => <span className="s">&quot;{s}&quot;</span>;
const IMPORT_APP = (
    <>
        <span className="k">import</span> {"{ app }"} <span className="k">from</span> {R("./app.ts")};
    </>
);
const SERVE_ENTRY = (
    <>
        <span className="k">import</span> {"{ serve }"} <span className="k">from</span> {R("@senrijs/senri/serve")};{"\n"}
        {IMPORT_APP}
        {"\n\n"}
        <span className="fn">serve</span>(app);
    </>
);
const SERVE_OUT = (cmd: string, port: number) => [
    <>
        <span className="wd">$</span> {cmd}
    </>,
    <>
        {"  "}
        <span className="sn">senr</span>
        <span className="sl">/</span>
        {"  "}
        <span className="gr">ready</span>
        {"  "}http://localhost:{port}
    </>,
    "",
    <>
        <span className="wd">$</span> curl localhost:{port}/users/42
    </>,
    '{"id":"42"}',
];

const RUNTIMES: Runtime[] = [
    { name: "Bun", file: "src/index.ts", entry: SERVE_ENTRY, term: "zsh", lines: SERVE_OUT("bun src/index.ts", 3927) },
    { name: "Node.js", file: "src/index.ts", entry: SERVE_ENTRY, term: "zsh", lines: SERVE_OUT("node src/index.ts", 3927) },
    { name: "Deno", file: "src/main.ts", entry: SERVE_ENTRY, term: "zsh", lines: SERVE_OUT("deno run --allow-net --allow-env=PORT,NODE_ENV src/main.ts", 3927) },
    {
        name: "Workers",
        file: "src/index.ts",
        entry: (
            <>
                {IMPORT_APP}
                {"\n\n"}
                <span className="k">export default</span> app;
            </>
        ),
        term: "zsh",
        lines: [
            <>
                <span className="wd">$</span> wrangler dev
            </>,
            <>
                {"  "}Ready on <span className="gr">http://localhost:8787</span>
            </>,
            "",
            <>
                <span className="wd">$</span> curl localhost:8787/users/42
            </>,
            '{"id":"42"}',
        ],
    },
    {
        name: "Browser",
        file: "src/sw.ts",
        entry: (
            <>
                {IMPORT_APP}
                {"\n\n"}self.<span className="fn">addEventListener</span>({R("fetch")}, (e) =&gt;{"\n"}
                {"  "}e.<span className="fn">respondWith</span>(app.<span className="fn">fetch</span>(e.request)));
            </>
        ),
        term: "Console — localhost",
        lines: [
            <>
                <span className="wd">&gt;</span> navigator.serviceWorker.<span className="fn">register</span>({R("/sw.js")})
            </>,
            "",
            <>
                <span className="wd">&gt;</span> <span className="k">await</span> <span className="fn">fetch</span>({R("/users/42")}).then((r) =&gt; r.json())
            </>,
            <>
                {"{id: "}
                {R("42")}
                {"}"}
            </>,
        ],
    },
];

function Runtimes({ lang }: { lang: Lang }) {
    const t = gridDict[lang];
    return (
        <Story className="rts" steps={5} height={2200} label={t.rtAria}>
            <div className="sst">
                <div className="row">
                    <div className="box grid two">
                        <Plus />
                        <div className="cell rsl">
                            <div className="rsh">{t.rtSame}</div>
                            {RUNTIMES.map((r, i) => (
                                <button key={r.name} type="button" className={`rsi k${i}`} data-goto={i} aria-label={t.rtShow(r.name)}>
                                    <span className="rsn">{String(i + 1).padStart(2, "0")}</span>
                                    <b>{r.name}</b>
                                    <span className="rsf">{r.file}</span>
                                </button>
                            ))}
                            <div className="rcap" aria-live="polite">
                                {t.rtCaps.map((cap, i) => (
                                    <p key={i} className={`cv v${i}`}>
                                        {cap}
                                    </p>
                                ))}
                            </div>
                            <div className="rbar" aria-hidden="true">
                                <i />
                            </div>
                        </div>
                        <div className="cell rsr">
                            <div className="rlab">{t.rtKeep}</div>
                            <div className="win ed">
                                <Bar title="my-app — Visual Studio Code" />
                                <div className="ebody">
                                    <Act />
                                    <div className="emain">
                                        <div className="tabs">
                                            <span className="on">src/app.ts</span>
                                            <span>package.json</span>
                                        </div>
                                        <Code
                                            lines={[
                                                <>
                                                    <span className="k">import</span> {"{ createApp }"} <span className="k">from</span> {R("@senrijs/senri")};
                                                </>,
                                                "",
                                                <>
                                                    <span className="k">export const</span> app = <span className="fn">createApp</span>();
                                                </>,
                                                "",
                                                <>
                                                    app.<span className="fn">get</span>({R("/users/:id")}, ({"{ id }"}) =&gt; ({"{ id }"}));
                                                </>,
                                            ]}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="rlab">{t.rtChange}</div>
                            {RUNTIMES.map((r, i) => (
                                <div key={r.name} className={`cv v${i} ent`}>
                                    <span className="dm">{r.file}</span>
                                    <pre>{r.entry}</pre>
                                </div>
                            ))}
                            {RUNTIMES.map((r, i) => (
                                <div key={r.name} className={`cv v${i}`}>
                                    <div className="win tm">
                                        <Bar title={r.term} />
                                        <div className="tmb">
                                            {r.lines.map((l, k) => (
                                                <div key={k}>{l === "" ? " " : l}</div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </Story>
    );
}

function Layers({ lang }: { lang: Lang }) {
    const t = gridDict[lang];
    const mws = ["Request", "requestId", "cors", "auth", "handler", "Response"];
    return (
        <Story className="lys" steps={4} height={1800} label={t.layAria} fixedLast>
            <div className="sst">
                <div className="row">
                    <div className="box grid two">
                        <Plus />
                        <div className="cell">
                            <Reveal as="p" className="big md" decorative>
                                LAYERS
                            </Reveal>
                            <Reveal label={t.layH.join(lang === "ja" ? "" : " ")}>
                                {t.layH[0]}
                                <br />
                                {t.layH[1]}
                            </Reveal>
                            <div className="scap">
                                {t.layScenes.map(([title, body], i) => (
                                    <div key={title} className={`cv v${i}`}>
                                        <span className="sno">
                                            {String(i + 1).padStart(2, "0")} — {String(t.layScenes.length).padStart(2, "0")}
                                        </span>
                                        <b>{title}</b>
                                        <p>{body}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="cell layers" aria-hidden="true">
                            <div className="ippo">
                                <span>{t.layIppo}</span>
                                <span>{t.layDev}</span>
                            </div>
                            <div className="lay l0">
                                <span className="lb">RUNTIME — Bun · Node.js · Deno · Workers · Browser</span>
                                <div className="lay l1" style={{ marginTop: 12 }}>
                                    <span className="lb">SENRI</span>
                                    <div className="mws">
                                        {mws.map((name, i) => (
                                            <Arrowed key={name} i={i} name={name} />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Story>
    );
}

function Arrowed({ i, name }: { i: number; name: string }) {
    return (
        <>
            {i > 0 ? <span className={`ar m${i}`}>→</span> : null}
            <span className={name === "handler" ? `m${i} h` : `m${i}`}>{name}</span>
        </>
    );
}

function Routing({ lang }: { lang: Lang }) {
    const t = gridDict[lang];
    const tree: [string, string][] = [
        ["t0", "app"],
        ["t1", "├── /users"],
        ["t2", "│   ├── GET    /users/:id"],
        ["tx", "│   ├── POST   /users"],
        ["tx", "│   └── DELETE /users/:id"],
        ["tx", "├── /posts"],
        ["tx", "│   └── GET    /posts"],
        ["tx", "└── /api/*"],
    ];
    return (
        <Story className="trs" steps={5} height={2000} label={t.trAria} fixedLast>
            <div className="sst">
                <div className="row">
                    <div className="box grid two">
                        <Plus />
                        <div className="cell">
                            <Reveal as="p" className="big md" decorative>
                                ROUTING
                            </Reveal>
                            <Reveal label={t.trH.join(lang === "ja" ? "" : " ")}>
                                {t.trH[0]}
                                <br />
                                {t.trH[1]}
                            </Reveal>
                            <div className="scap">
                                {t.trScenes.map(([title, body], i) => (
                                    <div key={title} className={`cv v${i}`}>
                                        <span className="sno">
                                            {String(i + 1).padStart(2, "0")} — {String(t.trScenes.length).padStart(2, "0")}
                                        </span>
                                        <b>{title}</b>
                                        <p>{body}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="cell tree" aria-hidden="true">
                            <div className="treq">
                                <span className="m">GET</span> /<span className="sg1">users</span>/<span className="sg2">42</span>
                            </div>
                            {tree.map(([cls, text], i) => (
                                <div key={i} className={`tl2 ${cls}`}>
                                    {text}
                                </div>
                            ))}
                            <div className="tres">
                                <span className="dm">params</span> {"{ id: "}
                                <span className="s2">&quot;42&quot;</span>
                                {" }"} <span className="dm">→ handler</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Story>
    );
}

// --- PATTERNS のコード。書き方は README とドキュメントのとおり ---

const K = (s: string) => <span className="k">{s}</span>;
const F = (s: string) => <span className="fn">{s}</span>;
const Q = (s: string) => <span className="s">&quot;{s}&quot;</span>;

const PATTERN_CODES: ReactNode[] = [
    <>
        app.{F("get")}({Q("/todos")}, () =&gt; [{"\n"}
        {"  { id: 1, title: "}
        {Q("牛乳を買う")}
        {" },\n]);"}
    </>,
    <>
        app.{F("use")}({F("cors")}());{"\n"}
        app.{F("use")}({F("secureHeaders")}());{"\n"}
        app.{F("use")}({F("rateLimit")}({"{ windowMs: 60_000, limit: 100 }"}));
    </>,
    <>
        app.{F("get")}({Q("/events")}, (_, c) =&gt;{"\n"}
        {"  "}
        {F("streamSSE")}(c, {K("async")} (s) =&gt; {"{\n    "}
        {K("await")} s.{F("writeSSE")}({"{ data: "}
        {Q("hi")}
        {" });\n  }));"}
    </>,
    <>
        {K("for await")} ({K("const")} part {K("of")} {F("multipart")}(c)) {"{\n  "}
        {K("if")} (part.filename !== {K("undefined")}){"\n    "}
        {K("await")} {F("save")}(part.filename, part.stream);{"\n}"}
    </>,
];

// --- TIMELINE: git log --graph の形。新しいものが上。中身は CHANGELOG.md のリリース ---

type Commit = { key: string; head: string; refs: { text: string; cls?: string }[]; date: string | null; plan?: boolean; now?: boolean };

const COMMITS: Commit[] = [
    { key: "ippo", head: "ippo", refs: [{ text: "planned: ippo", cls: "plan" }], date: null, plan: true },
    { key: "0.3.1", head: "0.3.1", refs: [{ text: "HEAD -> main", cls: "headref" }, { text: "tag: v0.3.1" }], date: "2026-11-12", now: true },
    { key: "0.3.0", head: "0.3.0", refs: [{ text: "tag: v0.3.0" }], date: "2026-11-12" },
    { key: "0.2.23", head: "0.2.23", refs: [{ text: "tag: v0.2.23" }], date: "2026-11-11" },
    { key: "0.2.22", head: "0.2.22", refs: [{ text: "tag: v0.2.22" }], date: "2026-11-11" },
    { key: "site", head: "site", refs: [{ text: "docs" }], date: "2026-11-08" },
    { key: "0.2.18", head: "0.2.18", refs: [{ text: "tag: v0.2.18" }], date: "2026-11-08" },
    { key: "0.2.0", head: "0.2.0", refs: [{ text: "tag: v0.2.0" }], date: "2026-10-27" },
    { key: "0.1.0", head: "0.1.0", refs: [{ text: "tag: v0.1.0" }], date: "2026-10-26" },
];

const ROW = 76;

function Timeline({ lang }: { lang: Lang }) {
    const t = gridDict[lang];
    const y = (i: number) => i * ROW + ROW / 2;
    const last = COMMITS.length - 1;
    const now = COMMITS.findIndex((c) => c.now);
    return (
        <>
            <section className="row" id="timeline">
                <div className="box">
                    <Plus />
                    <div className="head">
                        <Reveal className="big" label={`TIMELINE — ${t.tlLead}`}>
                            TIMELINE
                        </Reveal>
                        <p aria-hidden="true">{t.tlLead}</p>
                    </div>
                </div>
            </section>
            <section className="row" aria-label="TIMELINE">
                <div className="box">
                    <Plus />
                    <div className="glwrap">
                        <div className="glcmd" aria-hidden="true">
                            <span className="dl">$</span> git log --graph --tags
                        </div>
                        <div style={{ position: "relative" }}>
                            <svg className="glsvg" width="88" height={COMMITS.length * ROW} viewBox={`0 0 88 ${COMMITS.length * ROW}`} aria-hidden="true">
                                <line x1="30" y1={y(now)} x2="30" y2={y(last)} stroke="var(--line-3)" strokeWidth="2" />
                                {/* 予定の Ippo は、HEAD から破線で枝分かれ */}
                                <path d={`M58 ${y(0)} V${y(0) + 32} Q58 ${y(now)} 30 ${y(now)}`} fill="none" stroke="var(--plus)" strokeWidth="2" strokeDasharray="4 4" />
                                <circle cx="58" cy={y(0)} r="6" fill="var(--bg)" stroke="var(--plus)" strokeWidth="2" strokeDasharray="3 2" />
                                {COMMITS.map((c, i) =>
                                    c.plan ? null : c.now ? (
                                        <g key={c.key}>
                                            <circle cx="30" cy={y(i)} r="10" fill="var(--accent)" opacity=".15" />
                                            <circle cx="30" cy={y(i)} r="6" fill="var(--accent)" />
                                        </g>
                                    ) : (
                                        <circle key={c.key} cx="30" cy={y(i)} r="5" fill="var(--bg)" stroke="var(--muted)" strokeWidth="2" />
                                    ),
                                )}
                            </svg>
                            <ol className="gllist">
                                {COMMITS.map((c) => {
                                    const r = t.releases[c.key]!;
                                    return (
                                        <li key={c.key} className={c.plan ? "gl plan" : c.now ? "gl now" : "gl"} aria-current={c.now ? "step" : undefined}>
                                            <span className="gh">{c.head}</span>
                                            <div className="gm">
                                                <div className="gt">
                                                    {c.refs.map((ref) => (
                                                        <span key={ref.text} className={ref.cls ? `ref ${ref.cls}` : "ref"}>
                                                            {ref.text}
                                                        </span>
                                                    ))}
                                                    <b>{r.title}</b>
                                                </div>
                                                <span className="dm">{r.desc}</span>
                                            </div>
                                            <span className="gd">{c.date ? <time dateTime={c.date}>{c.date}</time> : t.tlPlanned}</span>
                                        </li>
                                    );
                                })}
                            </ol>
                        </div>
                        <a className="tlall" href={`${githubUrl}/releases`}>
                            {t.tlAll}
                        </a>
                    </div>
                </div>
            </section>
        </>
    );
}

