// 開発モードの 404。本番の 404 は errors.ts の defaultNotFound が、固定の文言だけで返す
// - ブラウザで開いたとき: ルートの一覧付きの 404 ページ(HTML)
// - それ以外: 「もしかして」付きのテキスト
import type { Context, HandlerResult } from "../context.ts";
import type { Route } from "../router.ts";
import { notFoundPage } from "./not-found-page.ts";
import { wantsHtml } from "./render.ts";
import { suggest } from "./suggest.ts";

export function devNotFound(c: Context, routes: Route[]): HandlerResult | Promise<HandlerResult> {
    if (wantsHtml(c.req)) return notFoundPage(c, routes);
    // ルートと同じく、デコード・正規化したパスで比べる(notFound に来るのはデコードできたリクエストだけ)
    const path = c.path;
    let message = `404 Not Found: ${c.req.method} ${path}`;
    const closest = suggest(routes, path);
    if (closest) {
        message += `\nもしかして: ${closest.method} ${closest.path} ?`;
    }
    return c.text(message);
}
