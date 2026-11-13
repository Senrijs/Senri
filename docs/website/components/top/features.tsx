"use client";
// FEATURES(3×2)。マスは本物の <button>。押すと、そのマスの位置から大きなダイアログが開く
// 02 のエラーの見本は、ビルドのときに本物の Senri で動かしたプレイグラウンドのエラー(lib/home/generated.json)
import { useCallback, useState } from "react";
import { gridDict } from "@/lib/home/grid-dict";
import { PLAYGROUND_CODE } from "@/lib/home/playground-code";
import type { Recording } from "@/lib/home/types";
import { type Lang, localePath } from "@/lib/i18n";
import { Dialog, type Origin, originOf } from "./dialog";
import { Plus } from "./plus";

type Err = NonNullable<Recording["error"]>;

function Chrome({ title }: { title: string }) {
    return (
        <span className="tbar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span className="ttl">{title}</span>
        </span>
    );
}

function Editor({ file, lines, children }: { file: string; lines: React.ReactNode[]; children?: React.ReactNode }) {
    return (
        <span className="win ed" style={{ height: 210 }}>
            <Chrome title="my-app — Visual Studio Code" />
            <span className="ebody">
                <span className="act">
                    <b />
                    <b />
                    <b />
                    <b />
                </span>
                <span className="emain">
                    <span className="tabs">
                        <span className="on">{file}</span>
                        <span>package.json</span>
                    </span>
                    <span className="code">
                        <span className="gut">
                            {lines.map((_, i) => (
                                <span key={i} style={{ display: "block" }}>
                                    {i + 1}
                                </span>
                            ))}
                        </span>
                        <span className="src">
                            {lines.map((l, i) => (
                                <span key={i} style={{ display: "block" }}>
                                    {l}
                                </span>
                            ))}
                            {children}
                        </span>
                    </span>
                </span>
            </span>
        </span>
    );
}

function Browser({ url, children }: { url: string; children: React.ReactNode }) {
    return (
        <span className="win br">
            <span className="bbar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span className="url">{url}</span>
            </span>
            <span className="bbody">{children}</span>
        </span>
    );
}

// ヒントの `...` をコードとして出す(Senri の開発用ページと同じ書き方)
function Rich({ text }: { text: string }) {
    return (
        <>
            {text.split(/(`[^`]+`)/).map((part, i) =>
                part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
            )}
        </>
    );
}

// 開発中のエラー画面の見本(行の前後と、ヒント)
export function ErrorView({ error, code, url }: { error: Err; code: string; url: string }) {
    const lines = code.split("\n");
    const hit = error.line;
    const frame = hit ? [hit - 1, hit, hit + 1].filter((n) => n >= 1 && n <= lines.length) : [];
    return (
        <Browser url={url}>
            <span className="errp">
                <span className="e1">
                    <span className="r">{error.name}</span>: {error.message}
                </span>
                {frame.length > 0 ? (
                    <span className="ecode">
                        {frame.map((n) => (
                            <span key={n} className={n === hit ? "hl" : undefined}>
                                <span className="ln">{n}</span>
                                {lines[n - 1]}
                            </span>
                        ))}
                    </span>
                ) : null}
                {error.hint ? (
                    <span className="e3" style={{ display: "block" }}>
                        <Rich text={error.hint} />
                    </span>
                ) : null}
            </span>
        </Browser>
    );
}

function Preview({ i, lang, error }: { i: number; lang: Lang; error: Err }) {
    const t = gridDict[lang];
    switch (i) {
        case 0:
            return (
                <Editor
                    file="src/index.ts"
                    lines={[
                        <span className="c">{"// Bun・Node.js・Deno"}</span>,
                        <>
                            <span className="fn">serve</span>(app);
                        </>,
                        " ",
                        <span className="c">{"// Cloudflare Workers"}</span>,
                        <>
                            <span className="k">export default</span> app;
                        </>,
                    ]}
                />
            );
        case 1:
            return <ErrorView error={error} code={PLAYGROUND_CODE} url="localhost:3927/me" />;
        case 2:
            return (
                <Browser url="localhost:3927/_senri">
                    <span className="dash">
                        <span className="dh">
                            <span className="dgm">GET</span> /users/42 <span className="dm">200 · 3.4ms</span>
                        </span>
                        {(
                            [
                                ["requestId", "0%", "100%", false],
                                ["cors", "4%", "92%", false],
                                ["auth", "10%", "80%", false],
                                ["handler", "30%", "52%", true],
                            ] as const
                        ).map(([name, l, w, hot]) => (
                            <span key={name} className={hot ? "bar hot" : "bar"} style={{ "--l": l, "--w": w } as React.CSSProperties}>
                                <span>{name}</span>
                            </span>
                        ))}
                    </span>
                </Browser>
            );
        case 3:
            return (
                <Editor
                    file="web/api.ts"
                    lines={[
                        <>
                            <span className="k">const</span> api = <span className="fn">client</span>&lt;Api&gt;(BASE);
                        </>,
                        <>
                            <span className="k">const</span> res = <span className="k">await</span> <span className="fn">api</span>(
                            <span className="s">&quot;GET /</span>
                        </>,
                        " ",
                        <>
                            <span className="k">if</span> (res.ok) res.data.id;
                        </>,
                    ]}
                >
                    <span className="ac" aria-hidden="true">
                        <span className="on">&quot;GET /users/:id&quot;</span>
                        <span>&quot;POST /users&quot;</span>
                        <span>&quot;GET /posts&quot;</span>
                        <span>&quot;DELETE /users/:id&quot;</span>
                    </span>
                </Editor>
            );
        case 4:
            return (
                <Browser url="localhost:3927/docs">
                    <span className="oa">
                        <span className="oah">
                            My API <span className="dm">1.0.0 · OAS 3.1</span>
                        </span>
                        {(
                            [
                                ["get", "GET", "/users/{id}"],
                                ["post", "POST", "/users"],
                                ["del", "DELETE", "/users/{id}"],
                            ] as const
                        ).map(([cls, m, p], n) => (
                            <span key={m} className="op">
                                <span className={`mt ${cls}`}>{m}</span>
                                {p}
                                <span className="dm">{t.oaOps[n]}</span>
                            </span>
                        ))}
                    </span>
                </Browser>
            );
        default:
            return (
                <span className="win tm" style={{ height: 210 }}>
                    <Chrome title="zsh — my-app" />
                    <span className="tmb">
                        <span style={{ display: "block" }}>
                            <span className="wd">$</span> curl -s localhost:3927/metrics
                        </span>
                        <span className="wd" style={{ display: "block" }}>
                            # TYPE http_server_request_duration_seconds histogram
                        </span>
                        <span style={{ display: "block" }}>http_server_request_duration_seconds_bucket{"{"}</span>
                        <span style={{ display: "block" }}>
                            {"  "}method=<span className="s">&quot;GET&quot;</span>,route=<span className="s">&quot;/users/:id&quot;</span>,
                        </span>
                        <span style={{ display: "block" }}>
                            {"  "}status=<span className="s">&quot;200&quot;</span>,le=<span className="s">&quot;0.005&quot;</span>
                            {"} "}
                            <span className="gr">412</span>
                        </span>
                        <span style={{ display: "block" }}>
                            http_server_active_requests{"{"}method=<span className="s">&quot;GET&quot;</span>
                            {"} "}
                            <span className="gr">3</span>
                        </span>
                    </span>
                </span>
            );
    }
}

export function Features({ lang, error }: { lang: Lang; error: Err }) {
    const t = gridDict[lang];
    const [open, setOpen] = useState<{ i: number; origin: Origin } | null>(null);
    const close = useCallback(() => setOpen(null), []);
    const f = open ? t.features[open.i]! : null;

    return (
        <section className="row" aria-labelledby="feat-title">
            <div className="box grid feats">
                <Plus />
                {t.features.map((feat, i) => (
                    <button
                        key={feat.title}
                        type="button"
                        className="cell f"
                        aria-haspopup="dialog"
                        onClick={(e) => setOpen({ i, origin: originOf(e.currentTarget) })}
                    >
                        <span className="fh">
                            <span className="num">{String(i + 1).padStart(2, "0")}</span>
                            <span className="ft">{feat.title}</span>
                            <span className="fd">{feat.desc}</span>
                        </span>
                        <span className="pv" aria-hidden="true">
                            <Preview i={i} lang={lang} error={error} />
                        </span>
                        <span className="zoom" aria-hidden="true">
                            {t.zoom}
                        </span>
                    </button>
                ))}
            </div>
            {open && f ? (
                <Dialog origin={open.origin} labelledBy="g-dlg-title" closeLabel={t.close} onClose={close}>
                    <div className="dlgh">
                        <span className="num">{String(open.i + 1).padStart(2, "0")}</span>
                        <h2 id="g-dlg-title">{f.title}</h2>
                        <p>{f.desc}</p>
                    </div>
                    <div className="dlgb">
                        <div className="dlgpv" aria-hidden="true">
                            <Preview i={open.i} lang={lang} error={error} />
                        </div>
                        <ul>
                            {f.points.map((p) => (
                                <li key={p}>{p}</li>
                            ))}
                            <li className="lk">
                                <a href={localePath(lang, f.href)}>{t.readDocs}</a>
                            </li>
                        </ul>
                    </div>
                </Dialog>
            ) : null}
        </section>
    );
}
