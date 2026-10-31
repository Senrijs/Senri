import type { Context, HandlerResult } from "./context.ts";

// status 付きで投げられるエラー。message はそのままクライアントに見せる前提のもの
/**
 * An error with an HTTP status. Throw it from a handler or middleware to respond with that status.
 * Its `headers` are added to the response, and the default error handler returns its `message`
 * to the client, so the message should be safe to show.
 *
 * @example
 * ```ts
 * import { createApp, HttpError } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.get("/admin", (_, c) => {
 *     if (!c.req.headers.get("authorization")) {
 *         throw new HttpError(401, "401 Unauthorized", { headers: { "www-authenticate": "Bearer" } });
 *     }
 *     return "welcome";
 * });
 * ```
 */
export class HttpError extends Error {
    /** The HTTP status code. */
    status: number;
    /** Headers to add to the error response. */
    headers: Headers;

    /**
     * Creates an error with an HTTP status.
     *
     * @param status The HTTP status code.
     * @param message Defaults to `"HTTP <status>"`.
     * @param options `headers` to add to the response, and the `cause`.
     */
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

/**
 * Handles an error thrown by middleware or a handler (`app.onError`). The status is already set
 * from the {@link HttpError}, or to 500. If it throws, a fixed `500 Internal Server Error` is returned.
 */
export type ErrorHandler<V extends object = any> = (err: unknown, c: Context<V>) => HandlerResult | Promise<HandlerResult>;
/** Handles a request that matched no route (`app.notFound`). The status is already set to 404. */
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

// Senri が投げるエラー。本体の文言は短い英語にして、開発モードでは code から日本語の説明を付ける
// (@senrijs/senri/dev の messages.ts。本体を小さくするため、長い説明は本体に持たない)
export function senriError<E extends Error>(code: string, error: E): E;
export function senriError(code: string, message: string): Error;
export function senriError(code: string, error: Error | string): Error {
    return Object.assign(typeof error === "string" ? new Error(error) : error, { code });
}

// Senri が投げたエラーの code(なければ undefined)
export function errorCode(err: unknown): string | undefined {
    const code = (err as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
}

// 本番の既定。エラーの中身(DB のパスワードなど)がもれないよう、固定の文言だけ返す
// (開発モードの詳しい文言とエラーページは @senrijs/senri/dev が差し替える)
export const defaultOnError: ErrorHandler = (err, c) =>
    c.text(err instanceof HttpError ? err.message : "500 Internal Server Error");

export const defaultNotFound: NotFoundHandler = (c) => c.text("404 Not Found");

export function methodNotAllowed(methods: string): HttpError {
    return senriError("method_not_allowed", new HttpError(405, "405 Method Not Allowed", { headers: { allow: methods } }));
}

// QUERY(RFC 10008)は、検索の条件をボディに入れて送るメソッド。ボディと、その形式(Content-Type)が必須
// ハンドラーを呼ぶ前に確かめる。どちらも問題なければ null
export async function checkQueryRequest(c: Context): Promise<HttpError | null> {
    if (await isEmptyBody(c)) return senriError("query_no_body", new HttpError(400, "400 Bad Request"));
    if (!c.req.headers.get("content-type")) {
        return senriError("query_no_type", new HttpError(415, "415 Unsupported Media Type"));
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
    // ミドルウェアが読み済みなら clone() は例外になる。読めたということは、ボディはあった
    if (req.bodyUsed) return false;

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
