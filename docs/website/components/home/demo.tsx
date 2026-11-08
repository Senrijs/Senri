"use client";
// ヒーローの「プレイグラウンド / ダッシュボード」のタブ
// プレイグラウンドは、いまはビルドのときに本物の Senri で動かした結果を見せる(ブラウザで動かす版はあとの PR)
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { homeDict } from "@/lib/home/dict";
import { PLAYGROUND_CODE, QUICK_PATHS, BOOM_PATH } from "@/lib/home/playground-code";
import type { Recording } from "@/lib/home/types";
import type { Lang } from "@/lib/i18n";
import { ErrorBox } from "./error-box";
import { ExpandDialog, type Origin } from "./expand-dialog";
import { WarnIcon } from "./icons";

const TABS = ["play", "dash"] as const;
type Tab = (typeof TABS)[number];

export function Demo({ lang, recordings, port }: { lang: Lang; recordings: Recording[]; port: number }) {
    const t = homeDict[lang];
    const [tab, setTab] = useState<Tab>("play");
    const refs = useRef<(HTMLButtonElement | null)[]>([]);

    // 矢印キーでタブを移る(WAI-ARIA のタブのパターン)
    function onKey(e: KeyboardEvent) {
        const i = TABS.indexOf(tab);
        const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
        if (next < 0) return;
        e.preventDefault();
        setTab(TABS[next]!);
        refs.current[next]?.focus();
    }

    const labels: Record<Tab, string> = { play: t.pgTab, dash: t.dashTab };
    return (
        <div className="s-demo s-up d4">
            <div className="s-tabs" role="tablist" aria-label={t.demo} onKeyDown={onKey}>
                {TABS.map((id, i) => (
                    <button
                        key={id}
                        ref={(el) => {
                            refs.current[i] = el;
                        }}
                        type="button"
                        role="tab"
                        id={`s-tab-${id}`}
                        aria-controls={`s-tabpanel-${id}`}
                        aria-selected={tab === id}
                        tabIndex={tab === id ? 0 : -1}
                        className="s-chip"
                        onClick={() => setTab(id)}
                    >
                        {labels[id]}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id={`s-tabpanel-${tab}`} aria-labelledby={`s-tab-${tab}`} className="s-panel s-glass">
                {tab === "play" ? <Playground lang={lang} recordings={recordings} /> : <Dashboard lang={lang} port={port} />}
            </div>
        </div>
    );
}

function statusTone(status: number) {
    return status >= 500 ? "s-tone-err" : status >= 400 ? "s-tone-warn" : status >= 300 ? "s-tone-redirect" : "s-tone-ok";
}

// JSON は読みやすく字下げして出す(中身は本物の Senri が返したもの)
function pretty(res: Recording): string | null {
    if (res.body === null) return null;
    if (!res.type?.startsWith("application/json")) return res.body;
    try {
        return JSON.stringify(JSON.parse(res.body), null, 2);
    } catch {
        return res.body;
    }
}

function Playground({ lang, recordings }: { lang: Lang; recordings: Recording[] }) {
    const t = homeDict[lang];
    const [method, setMethod] = useState("GET");
    const [path, setPath] = useState("/users/42");
    const [res, setRes] = useState<Recording | null>(null);
    const [missing, setMissing] = useState(false);
    const [dialog, setDialog] = useState<Origin | null>(null);

    function find(m: string, p: string) {
        const clean = p.split(/[?#]/)[0] || "/";
        return recordings.find((r) => r.method === m && r.path === clean) ?? null;
    }

    function send(m: string, p: string) {
        const hit = find(m, p);
        setMissing(hit === null);
        setRes(hit);
        return hit;
    }

    function boom(e: React.MouseEvent<HTMLButtonElement>) {
        const opener = e.currentTarget;
        setMethod("GET");
        setPath(BOOM_PATH);
        const hit = send("GET", BOOM_PATH);
        if (hit?.error) setDialog({ rect: opener.getBoundingClientRect(), opener });
    }

    const body = res ? (pretty(res) ?? t.noContent) : missing ? t.pgPreview : t.respEmpty;
    return (
        <>
            <div className="s-panel-bar">
                <span className="s-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </span>
                <span className="file">app.ts</span>
                <span className="note">
                    <span className="s-beacon sm still" style={{ background: "var(--green)" }} aria-hidden="true" />
                    {t.pgNote}
                </span>
            </div>
            <div className="s-pg">
                <div className="s-pg-code">
                    <textarea spellCheck={false} aria-label={t.pgCode} aria-describedby="s-pg-note" value={PLAYGROUND_CODE} readOnly />
                </div>
                <div className="s-pg-side">
                    <form
                        className="s-pg-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            send(method, path);
                        }}
                    >
                        <select aria-label={t.pgMethod} value={method} onChange={(e) => setMethod(e.target.value)}>
                            {["GET", "POST", "PUT", "DELETE"].map((m) => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                        <input type="text" aria-label={t.pgPath} value={path} onChange={(e) => setPath(e.target.value)} />
                        <button type="submit" className="s-btn-solid">
                            {t.send}
                        </button>
                    </form>
                    <p id="s-pg-note" className="s-pg-note">
                        {t.pgPreview}
                    </p>
                    <div className="s-quick">
                        {QUICK_PATHS.map((p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => {
                                    setMethod("GET");
                                    setPath(p);
                                    send("GET", p);
                                }}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                    <div className="s-res" aria-live="polite">
                        <div className="s-res-head">
                            <span className="label">{t.resp}</span>
                            <span className={`status ${res ? statusTone(res.status) : ""}`}>{res ? `${res.status} ${res.statusText}` : "—"}</span>
                        </div>
                        {res?.type ? <div className="s-res-meta">content-type: {res.type}</div> : null}
                        {res?.location ? <div className="s-res-meta">location: {res.location}</div> : null}
                        <pre>{body}</pre>
                        {res?.error ? (
                            <div style={{ padding: "0 14px 14px" }}>
                                <button
                                    type="button"
                                    className="s-open-err"
                                    aria-haspopup="dialog"
                                    onClick={(e) => setDialog({ rect: e.currentTarget.getBoundingClientRect(), opener: e.currentTarget })}
                                >
                                    {t.openErr} →
                                </button>
                            </div>
                        ) : null}
                    </div>
                    <button type="button" className="s-boom" onClick={boom}>
                        <WarnIcon />
                        {t.boom}
                    </button>
                </div>
            </div>
            {dialog && res?.error ? (
                <ExpandDialog origin={dialog} title={t.errTitle} description={t.errDesc} closeLabel={t.close} onClosed={() => setDialog(null)}>
                    <ErrorBox error={res.error} code={PLAYGROUND_CODE} file="app.ts" big />
                </ExpandDialog>
            ) : null}
        </>
    );
}

// ダッシュボード(/_senri)の見本
function Dashboard({ lang, port }: { lang: Lang; port: number }) {
    const t = homeDict[lang];
    const rows: [string, string, string, boolean][] = [
        ["GET", "/users/42", "200", true],
        ["POST", "/users", "201", false],
        ["GET", "/never-gonna-give-you-up", "302", false],
        ["GET", "/nope", "404", false],
        ["GET", "/files/report.pdf", "200", false],
    ];
    return (
        <>
            <div className="s-panel-bar">
                <span className="s-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </span>
                <span className="s-addr">
                    <span className="s-beacon sm still" style={{ background: "var(--accent)" }} aria-hidden="true" />
                    localhost:{port}/_senri
                </span>
            </div>
            <div className="s-dash">
                <ul aria-label={t.reqList}>
                    {rows.map(([m, p, s, on]) => (
                        <li key={p} className={on ? "on" : undefined}>
                            <span className={`m m-${m.toLowerCase()}`} style={{ fontWeight: 400 }}>
                                {m}
                            </span>
                            <span className="p">{p}</span>
                            <span className={s === "404" ? "st s-tone-err" : "st"}>{s}</span>
                        </li>
                    ))}
                </ul>
                <div className="s-dash-body">
                    <dl className="s-kv">
                        <KV label={t.kvMethod}>
                            <span className="m-get">GET</span>
                        </KV>
                        <KV label={t.kvPath}>/users/42</KV>
                        <KV label={t.kvRoute}>
                            <span>
                                /users/<span className="s-tone-err">:id</span>
                            </span>
                        </KV>
                        <KV label={t.kvStatus}>
                            <span className="s-beacon sm still" style={{ background: "var(--green)" }} aria-hidden="true" />
                            200
                        </KV>
                        <KV label={t.kvTime}>3 ms</KV>
                        <KV label={t.kvId}>
                            <span style={{ color: "var(--muted)" }}>7f3a9c</span>
                        </KV>
                    </dl>
                    <Bars
                        rows={[
                            ["requestId", "var(--bar1)", 0, 100],
                            ["cors", "var(--bar2)", 4, 92],
                            ["secureHeaders", "var(--bar3)", 8, 84],
                            ["auth", "var(--bar4)", 12, 76],
                            ["handler", "var(--accent)", 18, 58],
                        ]}
                    />
                </div>
            </div>
        </>
    );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

// ミドルウェアごとの時間の帯(玉ねぎのように、外側ほど長い)
export function Bars({ rows }: { rows: [string, string, number, number][] }) {
    return (
        <div className="s-bars">
            {rows.map(([name, color, left, width]) => (
                <div key={name} className="s-bar">
                    <span className={name === "handler" ? "main" : undefined}>{name}</span>
                    <div style={{ background: color, marginLeft: `${left}%`, width: `${width}%` }} />
                </div>
            ))}
        </div>
    );
}
