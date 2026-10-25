// 開発モードのエラーページを、Senri の処理の流れにつなぐ
//
// エラーページには「通った順番」(c.timings)を出したいが、onError が呼ばれた時点では、
// 外側のミドルウェアはまだ終わっていないので計測が揃っていない。そこで:
// 1. onError では「あとでエラーページにする」目印の付いた仮のレスポンス(本文はいつものテキスト)を返す
// 2. ミドルウェアを全部通り終えたあと(app.fetch の最後)に、目印があれば HTML に差し替える
//
// 目印は Response そのものではなく、リクエストごとの合言葉を入れた内部ヘッダーにしておく。
// こうすると、ミドルウェアが next() のあとで
// - c.header() や Set-Cookie を足しても(最後の c.finalize() で足される)
// - res.headers.set() で書き換えても
// - new Response(res.body, { status: 503, headers: res.headers }) と作り直しても
// 目印が残り、そのステータスとヘッダーのまま HTML にできる
import type { Context } from "../context.ts";
import type { ErrorHandler } from "../errors.ts";
import { buildErrorPageData } from "./error-page.ts";
import { errorFallback } from "./fallback.ts";
import { PAGE_HTML } from "./page.generated.ts";
import { renderPage, wantsHtml } from "./render.ts";

const MARK = "x-senri-dev-page";

// Context ごとの「エラーページにする予定」(リクエストが終われば一緒に消える)
const pending = new WeakMap<Context, { token: string; err: unknown }>();


// 既定の onError を包む。開発モードで、ブラウザから開いた 5xx のときだけ「あとでエラーページにする」
// (利用者が app.onError で自分のものに替えたら、これは使われない)
export function withErrorPage(base: ErrorHandler, dev: boolean): ErrorHandler {
    if (!dev) return base;
    return async (err, c) => {
        const res = c.toResponse(await base(err, c));
        // 4xx(意図して投げた HttpError など)は、今までどおりテキストのまま
        if (!wantsHtml(c.req) || res.status < 500) return res;
        return deferErrorPage(c, err, res);
    };
}

// 目印付きの仮のレスポンスを返す(本文はいつものテキストのまま)
function deferErrorPage(c: Context, err: unknown, fallback: Response): Response {
    const token = crypto.randomUUID();
    pending.set(c, { token, err });
    const headers = new Headers(fallback.headers);
    headers.set(MARK, token);
    return new Response(fallback.body, { status: fallback.status, statusText: fallback.statusText, headers });
}

// app.fetch の最後に呼ぶ。目印があれば HTML のエラーページに差し替える
export async function finishErrorPage(c: Context, res: Response): Promise<Response> {
    const mark = res.headers.get(MARK);
    if (mark === null) return res;

    // 内部ヘッダーは、どの場合でも外には出さない
    const headers = new Headers(res.headers);
    headers.delete(MARK);
    const job = pending.get(c);
    pending.delete(c);
    // 合言葉が合わない(ハンドラーが同じ名前のヘッダーを付けた、など)ならページにはしない
    if (!job || job.token !== mark) {
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    try {
        const data = await buildErrorPageData(job.err, c, res);
        await res.body?.cancel();
        headers.set("content-type", "text/html; charset=utf-8");
        // ボディを丸ごと差し替えるので、元のボディについてのヘッダーは消す
        // (圧縮ミドルウェアの content-encoding: gzip が残ると、ブラウザが展開に失敗して何も出ない)
        for (const name of ["content-length", "content-encoding", "etag", "last-modified", "content-range"]) {
            headers.delete(name);
        }
        const body = c.req.method === "HEAD" ? null : renderPage(PAGE_HTML, data, errorFallback(data));
        return new Response(body, { status: res.status, statusText: res.statusText, headers });
    } catch {
        // ページを作れなくても、いつものテキストのレスポンスは返す
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
}
