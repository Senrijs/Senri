import type { Context, HandlerResult } from "./context.ts";
import type { Route } from "./router.ts";
import { suggest } from "./dev/suggest.ts";

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

export type ErrorHandler = (err: unknown, c: Context) => HandlerResult | Promise<HandlerResult>;
export type NotFoundHandler = (c: Context) => HandlerResult | Promise<HandlerResult>;

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

export const defaultOnError: ErrorHandler = (err, c) => {
    if (err instanceof HttpError) {
        return c.text(err.message);
    }
    return c.text(`500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
};

export function methodNotAllowed(c: Context, path: string, methods: string): HttpError {
    return new HttpError(
        405,
        `405 Method Not Allowed: ${c.req.method} ${path}\n${methods} ならあります`,
        { headers: { allow: methods } },
    );
}

export function defaultNotFound(routes: Route[]): NotFoundHandler {
    return (c) => {
        const path = new URL(c.req.url).pathname;
        let message = `404 Not Found: ${c.req.method} ${path}`;
        const closest = suggest(routes, path);
        if (closest) {
            message += `\nもしかして: ${closest.method} ${closest.path} ?`;
        }
        return c.text(message);
    };
}
