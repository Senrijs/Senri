// サーバー(簡易表示)とブラウザ(Vue の画面)の両方で使う文言。en を元にして、ja は同じキーを必ず持つ
// `...` はコードとして表示する。{name} は値に置き換える
// サーバーだけが使う文言は server-messages.ts と explain.ts にある(画面のバンドルを大きくしないため)
import type { ConversionOrigin } from "../errors.ts";
import type { Lang } from "../lang.ts";
import type { Hint } from "./hints.ts";

export type Params = Record<string, string | number>;

// 1回だけ置き換える(値の中に {name} があっても、もう一度置き換えない)
export function fill(text: string, params?: Params): string {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

const FOOTER_EN = 'This page appears only in development mode (`import { devtools } from "@senrijs/senri/dev"` and `createApp({ dev: devtools() })`).';
const FOOTER_JA = 'このページは開発モード(`import { devtools } from "@senrijs/senri/dev"` と `createApp({ dev: devtools() })`)でのみ表示されます。';

const en = {
    "origin.handler": "The value returned by the handler of {name} could not be turned into a response",
    "origin.middleware": "The value returned by middleware {name} could not be turned into a response",
    "fallback.notice": "This page needs JavaScript for its full view. You see this simple view when something such as Content-Security-Policy blocks scripts.",

    "code.thrown": "thrown here",
    "code.error": "error here",
    "copy.copy": "Copy",
    "copy.done": "Copied",
    "editor.copyOnly": "Copy only",
    "editor.detected": " (detected)",
    "editor.experimental": " (experimental)",
    "editor.open": "Open in {editor}",

    "hint.nextTwice": "This middleware calls `next()` twice. Call `await next()` only once, and keep the result in a variable.",
    "hint.returnedFunction": "A function was returned without being called. Add `()` and return the result.",
    "hint.returnedNothing": "The handler returned no value. Check that `return` is not missing.",
    "hint.readNothing": "Tried to read `{prop}` from `undefined` or `null`. A missing `await`, or a `c.get()` with no value set, is a common cause. If the value is optional, read it with `?.`.",
    "hint.notFunction": "What was called is not a function. Check the spelling of the name and what is imported.",
    "hint.bigint": "`BigInt` cannot be turned into JSON. Convert it to a string or a number before returning it.",
    "hint.json": "This could not be read as JSON. With `c.req.json()`, the body that was sent is broken. That is a problem with the request, so answering with 400 is recommended.",
    "hint.jsonCode": 'const body = await c.req.json().catch(() => {\n    throw new HttpError(400, "Invalid JSON");\n});',
    "hint.uncaught": "An error thrown in a handler or middleware was not caught anywhere. If the error is intended, `HttpError` lets you choose the status code.",

    "error.codeLabel": "The code where the error occurred",
    "error.stack": "// Stack trace",
    "error.hideInternal": "Hide Senri internals",
    "error.showInternal": "Show Senri internals ({count})",
    "error.open": "Open",
    "error.hiddenFrames": "… {count} Senri internal frames",
    "error.request": "// Request",
    "error.noRoute": "(no match)",
    "error.layers": "// Layers, in order",
    "error.dashboardLink": "See details in /_senri →",
    "error.footer": `${FOOTER_EN} In production, only "{production}" is returned.`,

    "notFound.notFound": "was not found",
    "notFound.didYouMean": "did you mean:",
    "notFound.more": "… {count} more (narrow them down with filter)",
    "notFound.footer": `${FOOTER_EN} In production, only "404 Not Found" is returned, without the route list.`,

    "diff.missing": 'Missing {count} character(s): "{chars}"',
    "diff.extra": '{count} extra character(s): "{chars}"',
    "diff.changed": '"{was}" should be "{ch}"',
    "diff.many": "{count} differences",

    "routes.label": "Registered routes",
    "routes.title": "// Registered routes ({count})",
    "routes.empty": "No matching routes",
    "routes.lead": "The middleware a request to each route passes through on its way to the handler, in order (the left is the outermost).",
    "routes.leadMaybe": "applies depending on the path (on what a parameter such as `:page` receives).",
    "routes.maybe": "depends on the path",

    "mw.label": "Middleware",
    "mw.title": "// Middleware ({count})",
    "mw.lead": "Requests pass from the outside in, in the order registered with `app.use()`. `next()` moves to the next row, and after the handler they come back in reverse order.",
    "mw.handler": "The handler of the matched route",
    "mw.none": "No middleware is registered yet.",
    "mw.allPaths": "All paths",
    "mw.under": "{path} and below",
    "mw.anonymous": "anonymous#N is an unnamed function. Name it, as in app.use(function auth(c, next) { … }), to show that name here.",
    "mw.average": "avg {ms} ({count})",

    "dash.menu": "Dashboard menu",
    "dash.requests": "Requests",
    "dash.routes": "Routes",
    "dash.middleware": "Middleware",
    "dash.clear": "Clear",
    "dash.warningsLabel": "Route and middleware warnings",
    "dash.warningsTitle": "Possible mistakes ({count})",
    "dash.listLabel": "Request list",
    "dash.statusFilter": "Filter by status",
    "dash.all": "All",
    "dash.time": "// time",
    "dash.noRequests": "No requests yet. Open your app and they appear here.",
    "dash.noMatches": "No matching requests",
    "dash.retention": "Keeps the last {max} · Cleared on restart",
    "dash.gone": "This record is gone (only the last {max} are kept).",
    "dash.detailLabel": "Request details",
    "dash.noMatch": "(no match)",
    "dash.errorPage": "View the error page →",
    "dash.timeline": "// Onion timeline",
    "dash.self": "Own time",
    "dash.downstream": "Waiting for inner layers",
    "dash.requestHeaders": "// Request headers",
    "dash.responseHeaders": "// Response headers",
    "dash.masked": "*** (hidden)",
    "dash.skipped": "not reached",
    "dash.failed": "{ms} ✕ threw",
    "dash.stopped": "{ms} ← ended here",
    "dash.inner": "the inner layers",
    "dash.describeStopped": "{name} returned {status} without calling next(), so {inner} was not reached.",
    "dash.describeFailed": "{name} threw, and onError returned {status}.",
    "dash.describeNotFound": "No route matched, so notFound ran.",
    "dash.describeBusy": "Most of the time ({pct}%) was spent in {name}.",
};

/** A key of the page messages. */
export type MessageKey = keyof typeof en;

const ja: Record<MessageKey, string> = {
    "origin.handler": "{name} のハンドラーが返した値を、レスポンスにできませんでした",
    // ミドルウェア名は英数字なので、「が」との間に空白を入れて読みやすくする
    "origin.middleware": "ミドルウェア {name} が返した値を、レスポンスにできませんでした",
    "fallback.notice": "このページの詳しい表示には JavaScript が必要です。Content-Security-Policy などでスクリプトが止められているときは、この簡易表示になります。",

    "code.thrown": "ここで throw",
    "code.error": "ここでエラー",
    "copy.copy": "コピー",
    "copy.done": "コピーしました",
    "editor.copyOnly": "コピーのみ",
    "editor.detected": "(自動判別)",
    "editor.experimental": "(実験的)",
    "editor.open": "{editor} で開く",

    "hint.nextTwice": "1つのミドルウェアで `next()` を2回呼んでいます。`await next()` は1回だけにして、結果を変数に入れて使ってください。",
    "hint.returnedFunction": "関数を呼び出さずに返しています。`()` を付けて呼び出した結果を返してください。",
    "hint.returnedNothing": "ハンドラーが値を返していません。`return` を忘れていないか確かめてください。",
    "hint.readNothing": "`undefined` か `null` の値から `{prop}` を読もうとしました。`await` のし忘れや、`c.get()` で値が入っていない場合がよくあります。なくてもよい値なら `?.` で読めます。",
    "hint.notFunction": "呼び出そうとしたものが関数ではありません。名前のつづりや、import しているものを確かめてください。",
    "hint.bigint": "`BigInt` は JSON にできません。文字列や数値に変換してから返してください。",
    "hint.json": "JSON として読めませんでした。`c.req.json()` なら、送られてきたボディが壊れています。受け取った側の問題なので、400 で返すのがおすすめです。",
    "hint.jsonCode": 'const body = await c.req.json().catch(() => {\n    throw new HttpError(400, "JSON が正しくありません");\n});',
    "hint.uncaught": "ハンドラーやミドルウェアで投げたエラーが、どこでもキャッチされませんでした。意図したエラーなら `HttpError` でステータスコードを指定できます。",

    "error.codeLabel": "エラーが起きたコード",
    "error.stack": "// スタックトレース",
    "error.hideInternal": "Senri 内部を隠す",
    "error.showInternal": "Senri 内部も表示({count})",
    "error.open": "開く",
    "error.hiddenFrames": "… Senri 内部のフレーム {count}件",
    "error.request": "// リクエスト",
    "error.noRoute": "(マッチなし)",
    "error.layers": "// 通った順番",
    "error.dashboardLink": "/_senri で詳しく見る →",
    "error.footer": `${FOOTER_JA}本番では「{production}」だけが返ります。`,

    "notFound.notFound": "は見つかりませんでした",
    "notFound.didYouMean": "もしかして:",
    "notFound.more": "… ほか {count} 件(filter で絞り込めます)",
    "notFound.footer": `${FOOTER_JA}本番では「404 Not Found」だけが返り、ルートの一覧は出ません。`,

    "diff.missing": '"{chars}" が{count}文字足りません',
    "diff.extra": '"{chars}" が{count}文字多いです',
    "diff.changed": '"{ch}" のところが "{was}" になっています',
    "diff.many": "{count}か所違います",

    "routes.label": "登録されているルート",
    "routes.title": "// 登録されているルート({count})",
    "routes.empty": "一致するルートはありません",
    "routes.lead": "各ルートに来たリクエストが、どのミドルウェアをどの順に通ってハンドラーに着くかです(左が外側)。",
    "routes.leadMaybe": "はパスによってかかるもの(`:page` のようなパラメーターに何が来るか次第)です。",
    "routes.maybe": "パスによる",

    "mw.label": "ミドルウェア",
    "mw.title": "// ミドルウェア({count})",
    "mw.lead": "`app.use()` で登録した順に、外側から内側へ通ります。`next()` を呼ぶと次の行へ進み、ハンドラーまで行ったら、逆の順に戻ってきます。",
    "mw.handler": "マッチしたルートのハンドラー",
    "mw.none": "まだミドルウェアは登録されていません。",
    "mw.allPaths": "すべてのパス",
    "mw.under": "{path} とその下",
    "mw.anonymous": "anonymous#番号 は無名の関数です。app.use(function auth(c, next) { … }) のように名前付きの関数にすると、ここに名前が出ます。",
    "mw.average": "平均 {ms}({count}件)",

    "dash.menu": "ダッシュボードのメニュー",
    "dash.requests": "リクエスト",
    "dash.routes": "ルート",
    "dash.middleware": "ミドルウェア",
    "dash.clear": "クリア",
    "dash.warningsLabel": "ルートとミドルウェアの警告",
    "dash.warningsTitle": "書き間違いの可能性({count})",
    "dash.listLabel": "リクエスト一覧",
    "dash.statusFilter": "ステータスで絞り込む",
    "dash.all": "全部",
    "dash.time": "// 時刻",
    "dash.noRequests": "まだリクエストがありません。アプリを開くと、ここに増えていきます。",
    "dash.noMatches": "一致するリクエストはありません",
    "dash.retention": "直近 {max} 件まで保持 · 再起動で消えます",
    "dash.gone": "この記録はもうありません(直近 {max} 件だけ保持しています)。",
    "dash.detailLabel": "リクエストの詳細",
    "dash.noMatch": "(一致なし)",
    "dash.errorPage": "エラーページで見る →",
    "dash.timeline": "// 玉ねぎタイムライン",
    "dash.self": "自分の時間",
    "dash.downstream": "下流の待ち時間",
    "dash.requestHeaders": "// リクエストヘッダー",
    "dash.responseHeaders": "// レスポンスヘッダー",
    "dash.masked": "*** (伏せています)",
    "dash.skipped": "未到達",
    "dash.failed": "{ms} ✕ 例外",
    "dash.stopped": "{ms} ← ここで終了",
    "dash.inner": "内側",
    "dash.describeStopped": "{name} が next() を呼ばずに {status} を返したので、{inner} には届いていません。",
    "dash.describeFailed": "{name} で例外が起きて、onError が {status} を返しました。",
    "dash.describeNotFound": "一致するルートがないので notFound が動きました。",
    "dash.describeBusy": "ほとんどの時間({pct}%)は {name} で使われています。",
};

export const PAGE_MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, ja };

export function message(lang: Lang, key: MessageKey, params?: Params): string {
    return fill(PAGE_MESSAGES[lang][key], params);
}

// 返した値をレスポンスにできなかったときの説明(エラーの場所の代わりに出す)
export function originText(origin: ConversionOrigin, lang: Lang): string {
    return message(lang, origin.kind === "handler" ? "origin.handler" : "origin.middleware", { name: origin.name });
}

// ヒントは言語によらない形で記録しておいて(hints.ts)、表示するときに言語を決める
export function hintText(hint: Hint, lang: Lang): string {
    return message(lang, hint.key, hint.params);
}

export function hintCode(hint: Hint, lang: Lang): string | undefined {
    return hint.codeKey ? message(lang, hint.codeKey) : hint.code;
}
