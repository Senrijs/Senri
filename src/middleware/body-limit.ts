// リクエストのボディの大きさを制限する。超えたら 413
import type { Context, HandlerResult, Middleware } from "../context.ts";
import { HttpError } from "../errors.ts";

/** Options for {@link bodyLimit}. */
export type BodyLimitOptions = {
    // バイト数
    /** The maximum body size in bytes. */
    maxSize: number;
    // 超えたときのレスポンス。既定は "413 Content Too Large"
    /**
     * The response when the body is too large. Default: 413 `413 Content Too Large`.
     * When it returns something other than a `Response`, set the status yourself with `c.status(413)`.
     */
    onError?: (c: Context) => HandlerResult | Promise<HandlerResult>;
};

/**
 * Middleware that limits the request body size. Requests without a body pass through.
 * - With `Content-Length`: decided before reading. Over the limit, `onError` responds; a non-numeric value gets 400.
 *   The body is not counted in this case, so this assumes `Content-Length` can be trusted
 *   (the runtime's HTTP server does not accept a longer body than it declares).
 * - Without it (chunked): the body is counted while it is read. Over the limit, reading fails with an
 *   {@link HttpError} 413 and `onError` responds, even if the handler caught the error.
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
export function bodyLimit(options: BodyLimitOptions): Middleware {
    const max = options.maxSize;
    if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
        throw new Error(`bodyLimit(): maxSize には 0 以上のバイト数を指定してください(${String(max)})`);
    }
    // onError が文字列などを返しても 413 になるよう、先に status を入れておく(Response を返したら、その status のまま)
    const tooLarge = (c: Context) =>
        options.onError ? options.onError(c.status(413)) : new Response("413 Content Too Large", { status: 413 });

    return async function bodyLimit(c, next) {
        const body = c.req.body;
        if (body === null) return next();

        // Content-Length があれば、読む前に決められる(ランタイムが、それより長いボディは受け取らない)
        const length = c.req.headers.get("content-length");
        if (length !== null) {
            // 数字でない値(ふつうはランタイムの HTTP パーサーがはじく)は、長さが分からないので通さない
            if (!/^\s*\d+\s*$/.test(length)) return new Response("400 Bad Request", { status: 400 });
            return Number(length) > max ? tooLarge(c) : next();
        }

        // ない(チャンク転送など)ときは、読みながら数える。超えたらストリームをエラーにして、それ以上は読まない
        let exceeded = false;
        let size = 0;
        const reader = body.getReader();
        const limited = new ReadableStream<Uint8Array>({
            async pull(controller) {
                const { done, value } = await reader.read();
                if (done) return controller.close();
                size += value.byteLength;
                if (size > max) {
                    exceeded = true;
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
        c.req = new Request(c.req, { body: limited, duplex: "half" } as RequestInit);

        const res = await next();
        // ハンドラーがエラーを握りつぶしていても、超えていたら 413 にする
        return exceeded ? tooLarge(c) : res;
    };
}
