// リクエストのボディの大きさを制限する。超えたら 413
import type { Context, HandlerResult, Middleware } from "../context.ts";
import { HttpError } from "../errors.ts";

export type BodyLimitOptions = {
    // バイト数
    maxSize: number;
    // 超えたときのレスポンス。既定は "413 Content Too Large"
    onError?: (c: Context) => HandlerResult | Promise<HandlerResult>;
};

export function bodyLimit(options: BodyLimitOptions): Middleware {
    const max = options.maxSize;
    if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
        throw new Error(`bodyLimit(): maxSize には 0 以上のバイト数を指定してください(${String(max)})`);
    }
    const tooLarge = (c: Context) =>
        options.onError ? options.onError(c) : new Response("413 Content Too Large", { status: 413 });

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
