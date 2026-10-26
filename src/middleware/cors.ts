// CORS(よそのオリジンのページから、このサーバーを呼べるようにする)
import type { Context, Middleware } from "../context.ts";
import { appendVary, editable } from "./response.ts";

export type CorsOptions = {
    // 許可するオリジン。既定は "*"(どこからでも)
    // - 文字列 / 配列: 一致したときだけ返す
    // - 関数: true ならそのオリジンを、文字列ならその値を返す。false / null / undefined なら許可しない
    origin?: string | readonly string[] | ((origin: string, c: Context) => boolean | string | null | undefined);
    // プリフライトで許可するメソッド
    allowMethods?: readonly string[];
    // プリフライトで許可するリクエストヘッダー。指定しなければ、ブラウザが頼んできたものをそのまま許可する
    allowHeaders?: readonly string[];
    // JavaScript から読めるようにするレスポンスヘッダー
    exposeHeaders?: readonly string[];
    // Cookie などの資格情報を送らせる。origin: "*" とは一緒に使えない(ブラウザが受け付けない)
    credentials?: boolean;
    // プリフライトの結果をブラウザがキャッシュする秒数
    maxAge?: number;
};

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "QUERY"];

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
        if (requestOrigin === null) return next();
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
