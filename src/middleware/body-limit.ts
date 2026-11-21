// リクエストのボディの大きさを制限する。超えたら 413
import type { Context, HandlerResult, Middleware } from "../context.ts";
import { HttpError } from "../errors.ts";
import { hasNoBody, markPlainSafe } from "../plain.ts";
import { releaseBodyCap } from "../body-cap.ts";

/** Options for {@link bodyLimit}. */
export type BodyLimitOptions = {
    // バイト数
    /** The maximum body size in bytes. */
    maxSize: number;
    // 超えたときのレスポンス。渡さなければ HttpError(413) を投げて、アプリの onError に任せる(ほかのミドルウェアと同じ)
    /**
     * The response when the body is too large. Without it, an {@link HttpError} 413 (`413 Content Too Large`) is
     * thrown, so the app's `onError` makes the response, as for the other built-in middleware.
     * The status is set to 413 before it is called, so a returned string or object is sent with 413;
     * a returned `Response` keeps its own status.
     */
    onError?: (c: Context<any, any>) => HandlerResult | Promise<HandlerResult>;
};

// serve() の maxRequestBodySize を確かめる。省略すると上限なし(Infinity)。Infinity も渡せる
// (@senrijs/senri/serve と @senrijs/senri/node で同じ規則にするため、ここに置く)
export function checkMaxRequestBodySize(max: number | undefined): number {
    if (max === undefined) return Infinity;
    if (typeof max !== "number" || Number.isNaN(max) || max < 0) {
        throw new RangeError(`maxRequestBodySize must be a number of bytes, 0 or more: ${String(max)}`);
    }
    return max;
}

// 読みながら数えて、max を超えたら HttpError 413 でストリームをエラーにし、それ以上は読まない
// 超えたときに onExceeded を呼ぶ(ハンドラーがエラーを握りつぶしても、呼んだ側が 413 にできるように)
// serve() の maxRequestBodySize(Node.js と Deno)でも使う
export function countBytes(
    body: ReadableStream<Uint8Array>,
    max: number,
    onExceeded: () => void,
): ReadableStream<Uint8Array> {
    let size = 0;
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) return controller.close();
            size += value.byteLength;
            if (size > max) {
                onExceeded();
                controller.error(new HttpError(413, "413 Content Too Large"));
                await reader.cancel();
                return;
            }
            controller.enqueue(value);
        },
        cancel(reason) {
            return reader.cancel(reason);
        },
    });
}

/**
 * Middleware that limits the request body size. Requests without a body pass through.
 * - With `Content-Length`: decided before reading. Over the limit, `options.onError` responds (or an {@link HttpError}
 *   413 is thrown); a non-numeric value throws an `HttpError` 400.
 *   The body is not counted in this case, so this assumes `Content-Length` can be trusted
 *   (the runtime's HTTP server does not accept a longer body than it declares).
 * - Without it (chunked): the body is counted while it is read. Over the limit, reading fails with an
 *   {@link HttpError} 413, and `options.onError` responds (or an `HttpError` 413 is thrown again), even if the handler
 *   caught the error.
 *
 * Without `options.onError`, every error is thrown, so the body comes from `app.onError` and a typed client sees
 * 400 and 413 as declared statuses.
 *
 * Throws if `maxSize` is not a finite number of 0 or more.
 *
 * @example
 * ```ts
 * import { createApp, bodyLimit } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(bodyLimit({ maxSize: 1024 * 1024 })); // 1 MiB
 * ```
 */
// options.onError を渡したときの 413 は、その onError が返したもの。アプリの onError の本文ではないので、型には 400 だけを出す
export function bodyLimit(options: BodyLimitOptions & { onError: NonNullable<BodyLimitOptions["onError"]> }): Middleware<any, { errors: 400 }>;
/** Limits the request body size (see above). Without `options.onError`, it throws 400 and 413 for `app.onError` to answer. */
export function bodyLimit(options: BodyLimitOptions): Middleware<any, { errors: 400 | 413 }>;
export function bodyLimit(options: BodyLimitOptions): Middleware<any, any> {
    const max = options.maxSize;
    if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
        throw new Error(`bodyLimit(): maxSize must be a number of bytes, 0 or more (${String(max)})`);
    }
    // onError が文字列などを返しても 413 になるよう、先に status を入れておく(Response を返したら、その status のまま)
    // onError がなければ投げる。アプリの onError が本文を作る(0.4.0 から。それまでは固定の文字列を返していた)
    const tooLarge = (c: Context<any, any>) => {
        if (options.onError) return options.onError(c.status(413));
        throw new HttpError(413, "413 Content Too Large");
    };

    return markPlainSafe<Middleware<any, any>>(async function bodyLimit(c, next) {
        // アプリの既定の上限(createApp({ maxBodySize }))を、この上限で置き換える(重ねない)
        releaseBodyCap(c);
        // 本文がないと分かっていれば、Request を作らずに済ませる
        if (hasNoBody(c)) return next();
        const body = c.req.body;
        if (body === null) return next();

        // Content-Length があれば、読む前に決められる(ランタイムが、それより長いボディは受け取らない)
        const length = c.req.headers.get("content-length");
        if (length !== null) {
            // 数字でない値(ふつうはランタイムの HTTP パーサーがはじく)は、長さが分からないので通さない
            if (!/^\s*\d+\s*$/.test(length)) throw new HttpError(400, "400 Bad Request");
            return Number(length) > max ? tooLarge(c) : next();
        }

        // ない(チャンク転送など)ときは、読みながら数える。超えたらストリームをエラーにして、それ以上は読まない
        let exceeded = false;
        const limited = countBytes(body, max, () => (exceeded = true));
        c.req = new Request(c.req, { body: limited, duplex: "half" } as RequestInit);

        const res = await next();
        // ハンドラーがエラーを握りつぶしていても、超えていたら 413 にする
        // onError を渡していなければ、もう 413 になっている(アプリの onError が作った)応答は、そのまま返す(onError を 2 回呼ばない)
        if (!exceeded || (!options.onError && res.status === 413)) return res;
        return tooLarge(c);
    });
}
