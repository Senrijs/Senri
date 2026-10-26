import type { Context, HandlerResult } from "./context.ts";
import type { Route } from "./router.ts";
import { suggest } from "./dev/suggest.ts";
import { wantsHtml } from "./dev/render.ts";

// status 付きで投げられるエラー。message はそのままクライアントに見せる前提のもの
export class HttpError extends Error {
    status: number;
    headers: Headers;

    constructor(status: number, message?: string, options: { headers?: HeadersInit; cause?: unknown } = {}) {
        super(message ?? `HTTP ${status}`, { cause: options.cause });
        this.name = "HttpError";
        this.status = status;
        this.headers = new Headers(options.headers);
    }
}

// ハンドラーやミドルウェアが返した値を、Senri がレスポンスに変換する途中で失敗したときの印
// (例: { n: 1n } を返すと、JSON にするところで失敗する)
// このときのスタックには、返した側の行はもう残っていない(関数は返し終わっている)。
// 代わりに外側のミドルウェアの `await next()` の行が出てきて紛らわしいので、どこが返した値かを覚えておく
// エラーを包み直すと onError に届くエラーが変わってしまうので、エラーをキーにして横に置いておく
export type ConversionOrigin = { kind: "handler" | "middleware"; name: string };

const conversionOrigins = new WeakMap<object, ConversionOrigin>();

export function markConversionError(err: unknown, origin: ConversionOrigin): unknown {
    if (typeof err === "object" && err !== null) conversionOrigins.set(err, origin);
    return err;
}

export function conversionOriginOf(err: unknown): ConversionOrigin | null {
    return typeof err === "object" && err !== null ? (conversionOrigins.get(err) ?? null) : null;
}

export type ErrorHandler<V extends object = any> = (err: unknown, c: Context<V>) => HandlerResult | Promise<HandlerResult>;
export type NotFoundHandler<V extends object = any> = (c: Context<V>) => HandlerResult | Promise<HandlerResult>;

// onError を通して、例外をレスポンスに変える
// HttpError なら status と headers を先に c に入れておくので、onError が文字列を返すだけでも正しい status になる
export async function handleError(err: unknown, c: Context, onError: ErrorHandler): Promise<Response> {
    if (err instanceof HttpError) {
        c.status(err.status);
        err.headers.forEach((value, key) => c.header(key, value));
    } else {
        c.status(500);
    }
    // ログに出すべき「本当のエラー」だけ c.error に入れる(404 や 403 はふつうの応答)
    if (!(err instanceof HttpError) || err.status >= 500) {
        c.error = err;
    }
    try {
        return c.toResponse(await onError(err, c));
    } catch (onErrorFailed) {
        // onError 自体が壊れていたら、もう頼れるものがないので固定の 500 を返す
        c.error = onErrorFailed;
        return new Response("500 Internal Server Error", { status: 500 });
    }
}

// 本番では、エラーの中身(DB のパスワードなど)や、ルートの一覧がもれないよう固定の文言だけ返す
// dev: true のときだけ、開発者向けの詳しい情報を足す

export function defaultOnError(dev: boolean): ErrorHandler {
    return (err, c) => {
        if (err instanceof HttpError) {
            return c.text(err.message);
        }
        if (!dev) {
            return c.text("500 Internal Server Error");
        }
        return c.text(`500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
    };
}

export function methodNotAllowed(c: Context, path: string, methods: string, dev: boolean): HttpError {
    const message = dev
        ? `405 Method Not Allowed: ${c.req.method} ${path}\n${methods} ならあります`
        : "405 Method Not Allowed";
    return new HttpError(405, message, { headers: { allow: methods } });
}

// QUERY(RFC 10008)は、検索の条件をボディに入れて送るメソッド。ボディと、その形式(Content-Type)が必須
// ハンドラーを呼ぶ前に確かめる。どちらも問題なければ null
export async function checkQueryRequest(c: Context, dev: boolean): Promise<HttpError | null> {
    if (await isEmptyBody(c)) {
        return new HttpError(
            400,
            dev
                ? "400 Bad Request: QUERY リクエストにボディがありません\nQUERY は、検索の条件をボディに入れて送るメソッドです"
                : "400 Bad Request",
        );
    }
    if (!c.req.headers.get("content-type")) {
        return new HttpError(
            415,
            dev
                ? "415 Unsupported Media Type: QUERY リクエストに Content-Type がありません\nボディの形式を指定してください(例: Content-Type: application/json)"
                : "415 Unsupported Media Type",
        );
    }
    return null;
}

// ボディが空か。Content-Length があればそれで決める
// ないとき(Deno はボディがなくても空のストリームを渡す。チャンク転送のこともある)は、
// 複製(clone)のほうを中身のあるチャンクが来るまで読んで確かめる。元の c.req はそのまま読める
async function isEmptyBody(c: Context): Promise<boolean> {
    const req = c.req;
    if (req.body === null) return true;
    const length = req.headers.get("content-length");
    if (length !== null) return length.trim() === "0";

    const reader = req.clone().body!.getReader();
    try {
        // 長さ 0 のチャンクが来ることもある(Deno)
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return true;
            if (value.byteLength > 0) return false;
        }
    } finally {
        // 複製のほうはもう読まない(元のほうに、読んだ分ため込まれ続けないようにする)
        reader.cancel().catch(() => {});
    }
}

export function defaultNotFound(routes: Route[], dev: boolean): NotFoundHandler {
    return async (c) => {
        if (!dev) {
            return c.text("404 Not Found");
        }
        // ブラウザで開いたときは、ルートの一覧付きの404ページ(HTML)にする
        // ページの HTML は大きいので、本番では読み込まないよう、ここで初めて import() する
        if (wantsHtml(c.req)) {
            const { notFoundPage } = await import("./dev/not-found-page.ts");
            return notFoundPage(c, routes);
        }
        // ルートと同じく、デコード・正規化したパスで比べる(notFound に来るのはデコードできたリクエストだけ)
        const path = c.path;
        let message = `404 Not Found: ${c.req.method} ${path}`;
        const closest = suggest(routes, path);
        if (closest) {
            message += `\nもしかして: ${closest.method} ${closest.path} ?`;
        }
        return c.text(message);
    };
}
