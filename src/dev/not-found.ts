// 開発モードの 404。本番の 404 は errors.ts の defaultNotFound が、固定の文言だけで返す
// - ブラウザで開いたとき: ルートの一覧付きの 404 ページ(HTML)
// - それ以外: 「もしかして」付きのテキスト
import type { Context, HandlerResult } from "../context.ts";
import { defaultNotFound } from "../errors.ts";
import type { Lang } from "../lang.ts";
import type { Route } from "../router.ts";
import { notFoundPage } from "./not-found-page.ts";
import { wantsHtml } from "./render.ts";
import { serverMessage } from "./server-messages.ts";
import { suggest } from "./suggest.ts";

// lang: 開発用の文言を出すときだけ呼ぶ(呼んだら、応答が Accept-Language で変わる)
export function devNotFound(c: Context, routes: Route[], lang: () => Lang): HandlerResult | Promise<HandlerResult> {
    // ルートと同じく、デコード・正規化したパスで比べる
    // デコードできないパスでミドルウェアが c.notFound() を呼ぶと、c.path は HttpError 400 を投げる
    // パスを出せないので、本番と同じ固定の 404 にする
    let path: string;
    try {
        path = c.path;
    } catch {
        return defaultNotFound(c);
    }
    if (wantsHtml(c.req)) return notFoundPage(c, routes, lang());
    let message = `404 Not Found: ${c.req.method} ${path}`;
    // ルートがあるのに c.notFound() を呼んだときは、提案しない(c.route はミドルウェアより先に決まる)
    const closest = c.route === undefined ? suggest(routes, path) : null;
    if (closest) {
        message += `\n${serverMessage(lang(), "res.didYouMean", { method: closest.method, path: closest.path })}`;
    }
    return c.text(message);
}
