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

export function defaultNotFound(routes: Route[], dev: boolean): NotFoundHandler {
    return (c) => {
        if (!dev) {
            return c.text("404 Not Found");
        }
        const path = new URL(c.req.url).pathname;
        let message = `404 Not Found: ${c.req.method} ${path}`;
        const closest = suggest(routes, path);
        if (closest) {
            message += `\nもしかして: ${closest.method} ${closest.path} ?`;
        }
        return c.text(message);
    };
}
