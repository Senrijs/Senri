// CORS(よそのオリジンのページから、このサーバーを呼べるようにする)
import type { Context, Middleware } from "../context.ts";
import { appendVary, editable } from "./response.ts";

/** Options for {@link cors}. */
export type CorsOptions = {
    // 許可するオリジン。既定は "*"(どこからでも)
    // - 文字列 / 配列: 一致したときだけ返す
    // - 関数: true ならそのオリジンを、文字列ならその値を返す。false / null / undefined なら許可しない
    /**
     * Allowed origins. Default `"*"` (any origin).
     * - A string or an array: allowed only on an exact match
     * - A function: `true` allows the request's origin, a string is sent as is, and `false` / `null` / `undefined` deny it
     */
    origin?: string | readonly string[] | ((origin: string, c: Context) => boolean | string | null | undefined);
    // プリフライトで許可するメソッド
    /** Methods allowed in preflight responses. Default GET, HEAD, PUT, POST, DELETE, PATCH, QUERY. */
    allowMethods?: readonly string[];
    // プリフライトで許可するリクエストヘッダー。指定しなければ、ブラウザが頼んできたものをそのまま許可する
    /** Request headers allowed in preflight responses. Default: the headers the browser asked for. */
    allowHeaders?: readonly string[];
    // JavaScript から読めるようにするレスポンスヘッダー
    /** Response headers that JavaScript may read (`Access-Control-Expose-Headers`). */
    exposeHeaders?: readonly string[];
    // Cookie などの資格情報を送らせる。origin: "*" とは一緒に使えない(ブラウザが受け付けない)
    /** Allow credentials such as cookies. Cannot be used with `origin: "*"` (the default); {@link cors} throws. */
    credentials?: boolean;
    // プリフライトの結果をブラウザがキャッシュする秒数
    /** How long, in seconds, the browser may cache a preflight response. */
    maxAge?: number;
};

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "QUERY"];

/**
 * CORS middleware. Answers preflight requests (OPTIONS with `Access-Control-Request-Method`) with 204 itself,
 * and adds CORS headers to other responses. For origins that are not allowed, no CORS headers are added.
 * Unless `origin` is `"*"`, `Vary: Origin` is added. Responses with a status below 200 are left unchanged.
 * Throws if `credentials` is `true` with `origin: "*"`.
 *
 * @example
 * ```ts
 * import { createApp, cors } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(cors({ origin: ["https://example.com"], credentials: true }));
 * ```
 */
export function cors(options: CorsOptions = {}): Middleware {
    const origin = options.origin ?? "*";
    if (options.credentials && origin === "*") {
        throw new Error('cors(): credentials: true のときは origin: "*" は使えません。許可するオリジンを指定してください');
    }
    const methods = (options.allowMethods ?? DEFAULT_METHODS).join(", ");
    const expose = options.exposeHeaders?.join(", ");
    // "*" 以外は、リクエストのオリジンによって答えが変わるので Vary: Origin が要る
    const varies = origin !== "*";

    const allowOrigin = (requestOrigin: string, c: Context): string | null => {
        if (origin === "*") return "*";
        if (typeof origin === "string") return origin === requestOrigin ? origin : null;
        if (typeof origin === "function") {
            const result = origin(requestOrigin, c);
            return result === true ? requestOrigin : typeof result === "string" ? result : null;
        }
        return origin.includes(requestOrigin) ? requestOrigin : null;
    };

    return async function cors(c, next) {
        const requestOrigin = c.req.headers.get("origin");
        if (requestOrigin === null) {
            if (!varies) return next();
            // 許可するオリジンがリクエストで変わるなら、Origin のないレスポンスにも Vary: Origin を付ける
            // (付けないと、共有キャッシュが CORS ヘッダーのないこのレスポンスを、ほかのオリジンにも返してしまう)
            const downstream = await next();
            if (downstream.status < 200) return downstream;
            const res = editable(downstream);
            appendVary(res.headers, "Origin");
            return res;
        }
        const allowed = allowOrigin(requestOrigin, c);

        // プリフライト(本番のリクエストの前に、ブラウザが「送ってよいか」を OPTIONS で聞いてくるもの)には、ここで答える
        const requestMethod = c.req.headers.get("access-control-request-method");
        if (c.req.method === "OPTIONS" && requestMethod !== null) {
            const headers = new Headers();
            if (varies) appendVary(headers, "Origin");
            if (allowed !== null) {
                headers.set("access-control-allow-origin", allowed);
                headers.set("access-control-allow-methods", methods);
                if (options.allowHeaders) {
                    headers.set("access-control-allow-headers", options.allowHeaders.join(", "));
                } else {
                    const requested = c.req.headers.get("access-control-request-headers");
                    if (requested) headers.set("access-control-allow-headers", requested);
                    appendVary(headers, "Access-Control-Request-Headers");
                }
                if (options.credentials) headers.set("access-control-allow-credentials", "true");
                if (options.maxAge !== undefined) headers.set("access-control-max-age", String(Math.floor(options.maxAge)));
            }
            return new Response(null, { status: 204, headers });
        }

        const downstream = await next();
        // 101(WebSocket のアップグレード)などは作り直すと壊れるので触らない(finalize() と同じ)
        if (downstream.status < 200) return downstream;
        const res = editable(downstream);
        if (varies) appendVary(res.headers, "Origin");
        if (allowed !== null) {
            res.headers.set("access-control-allow-origin", allowed);
            if (options.credentials) res.headers.set("access-control-allow-credentials", "true");
            if (expose) res.headers.set("access-control-expose-headers", expose);
        }
        return res;
    };
}
