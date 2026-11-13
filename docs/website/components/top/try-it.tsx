"use client";
// TRY IT: 本物のプレイグラウンド(components/home/playground-client.ts と public/playground/worker.js)を、見本の窓の見た目にはめたもの
// - 最初のコードのままで、記録があるパスなら、ビルドのときに本物の Senri で動かした結果(記録)を出す(Worker を読み込まない)
// - コードを書き換えたり、記録にないパスを送ったりすると、ブラウザの Worker で本物の Senri を動かす
import { useCallback, useRef, useState } from "react";
import { run, type RunError } from "@/components/home/playground-client";
import { homeDict } from "@/lib/home/dict";
import { gridDict } from "@/lib/home/grid-dict";
import { BOOM_PATH, PLAYGROUND_CODE, QUICK_PATHS } from "@/lib/home/playground-code";
import type { Recording } from "@/lib/home/types";
import type { Lang } from "@/lib/i18n";
import { Dialog, type Origin, originOf } from "./dialog";
import { ErrorView } from "./features";

// ブラウザの Response は statusText が空のことがあるので、よく使うものだけ補う
const REASONS: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    413: "Content Too Large",
    415: "Unsupported Media Type",
    422: "Unprocessable Content",
    429: "Too Many Requests",
    500: "Internal Server Error",
    503: "Service Unavailable",
};

type State = "idle" | "recorded" | "live" | "running" | "timeout" | "build" | "unavailable";

function pretty(res: Recording): string | null {
    if (res.body === null) return null;
    if (!res.type?.startsWith("application/json")) return res.body;
    try {
        return JSON.stringify(JSON.parse(res.body), null, 2);
    } catch {
        return res.body;
    }
}

const tone = (status: number) => (status >= 500 ? "st-err" : status >= 400 ? "st-warn" : "st-ok");

export function TryIt({ lang, recordings, port }: { lang: Lang; recordings: Recording[]; port: number }) {
    const t = homeDict[lang];
    const g = gridDict[lang];
    const [code, setCode] = useState(PLAYGROUND_CODE);
    const [method, setMethod] = useState("GET");
    const [path, setPath] = useState("/users/42");
    const [sent, setSent] = useState("GET /users/42");
    const [res, setRes] = useState<Recording | null>(null);
    const [state, setState] = useState<State>("idle");
    const [buildError, setBuildError] = useState<RunError | null>(null);
    const [dialog, setDialog] = useState<Origin | null>(null);
    const latest = useRef(0);
    const gutter = useRef<HTMLDivElement>(null);
    const closeDialog = useCallback(() => setDialog(null), []);

    async function send(m: string, p: string): Promise<Recording | null> {
        const clean = p.trim() || "/";
        const full = clean.startsWith("/") ? clean : `/${clean}`;
        setSent(`${m} ${full}`);
        if (code === PLAYGROUND_CODE) {
            const hit = recordings.find((r) => r.method === m && r.path === (full.split(/[?#]/)[0] || "/"));
            if (hit) {
                setRes(hit);
                setBuildError(null);
                setState("recorded");
                return hit;
            }
        }
        const ticket = ++latest.current;
        setState("running");
        const result = await run({ code, method: m, path: full, lang, port });
        if (ticket !== latest.current) return null;
        if (result.kind === "response") {
            setRes(result.recording);
            setBuildError(null);
            setState("live");
            return result.recording;
        }
        setRes(null);
        setBuildError(result.kind === "build" ? result.error : null);
        setState(result.kind);
        return null;
    }

    function quick(p: string) {
        setMethod("GET");
        setPath(p);
        void send("GET", p);
    }

    const lines = code.split("\n").length;
    const shown = state === "live" || state === "recorded";
    let body: string;
    if (state === "running") body = t.pgRunning;
    else if (state === "timeout") body = t.pgTimeout;
    else if (state === "unavailable") body = t.pgUnavailable;
    else if (state === "build" && buildError) body = `${t.pgBuildErr}\n\n${buildError.name}: ${buildError.message}`;
    else if (res) body = pretty(res) ?? t.noContent;
    else body = t.respEmpty;
    const error = state === "build" ? buildError : shown ? res?.error : null;
    const live = state === "live" || state === "build" || state === "running" || state === "timeout";

    return (
        <section className="row" aria-labelledby="try-title">
            <div className="box grid try">
                <i className="p ptl" aria-hidden="true" />
                <i className="p ptr" aria-hidden="true" />
                <div className="cell">
                    <div className="win ed">
                        <div className="tbar" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                            <span className="ttl">my-app — Visual Studio Code</span>
                        </div>
                        <div className="ebody">
                            <div className="act" aria-hidden="true">
                                <b />
                                <b />
                                <b />
                                <b />
                            </div>
                            <div className="emain">
                                <div className="tabs" aria-hidden="true">
                                    <span className="on">app.ts</span>
                                    <span>package.json</span>
                                </div>
                                <div className="code">
                                    <div ref={gutter} className="gut" aria-hidden="true">
                                        {Array.from({ length: lines }, (_, i) => (
                                            <div key={i}>{i + 1}</div>
                                        ))}
                                        <div style={{ height: 24 }} />
                                    </div>
                                    <textarea
                                        spellCheck={false}
                                        aria-label={t.pgCode}
                                        aria-describedby="try-help"
                                        value={code}
                                        maxLength={20000}
                                        onChange={(e) => setCode(e.target.value)}
                                        onScroll={(e) => {
                                            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    <form
                        className="ctrl"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void send(method, path);
                        }}
                    >
                        <select aria-label={t.pgMethod} value={method} onChange={(e) => setMethod(e.target.value)}>
                            {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                        <input type="text" aria-label={t.pgPath} value={path} onChange={(e) => setPath(e.target.value)} />
                        <button type="submit" disabled={state === "running"}>
                            {t.send}
                        </button>
                    </form>
                    <div className="hints">
                        {QUICK_PATHS.map((p) => (
                            <button key={p} type="button" onClick={() => quick(p)}>
                                {p}
                            </button>
                        ))}
                        <button type="button" className="boom" onClick={() => quick(BOOM_PATH)}>
                            {g.tryBoom}
                        </button>
                        {code !== PLAYGROUND_CODE ? (
                            <button type="button" onClick={() => setCode(PLAYGROUND_CODE)}>
                                {t.pgReset}
                            </button>
                        ) : null}
                    </div>
                    <p id="try-help" className="note">
                        {g.tryHelp}
                    </p>
                </div>
                <div className="cell">
                    <div className="win br">
                        <div className="bbar">
                            <i aria-hidden="true" />
                            <i aria-hidden="true" />
                            <i aria-hidden="true" />
                            <div className="url">
                                <span className="sr-only">{t.resp}: </span>
                                {sent}
                            </div>
                        </div>
                        <div className="bbody" aria-live="polite" aria-busy={state === "running"}>
                            <pre className="resp">
                                {shown && res ? (
                                    <>
                                        <span className={tone(res.status)}>{`${res.status} ${res.statusText || REASONS[res.status] || ""}`.trim()}</span>
                                        {res.type ? <span className="dm">{`  ${res.type}`}</span> : null}
                                        {res.location ? <span className="dm">{`\nlocation: ${res.location}`}</span> : null}
                                        {"\n\n"}
                                    </>
                                ) : null}
                                {body.split("\n").map((line, i) => (
                                    <span key={i} className={/^(もしかして|Did you mean)/i.test(line) ? "hint" : undefined}>
                                        {i > 0 ? "\n" : ""}
                                        {line}
                                    </span>
                                ))}
                            </pre>
                            {error ? (
                                <button type="button" className="openerr" aria-haspopup="dialog" onClick={(e) => setDialog(originOf(e.currentTarget))}>
                                    {t.openErr} →
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <p className="note">{live ? g.tryLive : g.tryRecorded}</p>
                </div>
            </div>
            {dialog && error ? (
                <Dialog origin={dialog} labelledBy="try-dlg-title" closeLabel={t.close} onClose={closeDialog}>
                    <div className="dlgh">
                        <h2 id="try-dlg-title">{t.errTitle}</h2>
                        <p>{state === "recorded" ? t.errDesc : t.errDescLive}</p>
                    </div>
                    <div className="dlgerr">
                        <ErrorView error={error} code={code} url={`localhost:${port}${sent.split(" ")[1] ?? ""}`} />
                    </div>
                </Dialog>
            ) : null}
        </section>
    );
}
