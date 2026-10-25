// スクリプトが動かないときに見える、最低限の HTML
//
// ページは Vue(インラインのスクリプト)で描画するので、利用者のミドルウェアが
// Content-Security-Policy を付けていると、スクリプトが止められて真っ白になってしまう。
// そこで <div id="app"> の中に、サーバー側で作った簡易表示を最初から入れておく。
// Vue が動けば丸ごと置き換わり、止められればこれがそのまま見える
// (中身は全部 escapeHtml を通す。エラーメッセージやパスは攻撃者が決められるので)
import { escapeHtml } from "./html.ts";
import { originText } from "./messages.ts";
import type { ErrorPageData, NotFoundPageData } from "./page-data.ts";

const NOTICE =
    "このページの詳しい表示には JavaScript が必要です。Content-Security-Policy などでスクリプトが止められているときは、この簡易表示になります。";

export function errorFallback(d: ErrorPageData): string {
    const where = d.origin
        ? originText(d.origin)
        : d.location
          ? `${d.location.display}:${d.location.line}:${d.location.col}`
          : null;
    const frames = d.frames
        .filter((f) => f.kind !== "senri" && f.kind !== "runtime")
        .map((f) => `${f.fn}  ${f.display}:${f.line}:${f.col}`)
        .join("\n");
    return [
        "<main>",
        `<p>${escapeHtml(`${d.request.method} ${d.request.path} · ${d.status} ${d.statusText}`)}</p>`,
        `<h1>${escapeHtml(`${d.error.name}: ${d.error.message}`)}</h1>`,
        where ? `<p>--&gt; ${escapeHtml(where)}</p>` : "",
        frames ? `<pre>${escapeHtml(frames)}</pre>` : "",
        `<p>${escapeHtml(NOTICE)}</p>`,
        "</main>",
    ].join("");
}

export function notFoundFallback(d: NotFoundPageData): string {
    return [
        "<main>",
        "<p>404 Not Found</p>",
        `<h1>${escapeHtml(`${d.method} ${d.path}`)} は見つかりませんでした</h1>`,
        d.suggestion ? `<p>もしかして: ${escapeHtml(`${d.suggestion.method} ${d.suggestion.path}`)}</p>` : "",
        `<p>${escapeHtml(NOTICE)}</p>`,
        "</main>",
    ].join("");
}
