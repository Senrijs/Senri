// よく使われるセキュリティ系のレスポンスヘッダーをまとめて付ける
import type { Middleware } from "../context.ts";
import { editable } from "./response.ts";

// 文字列: その値にする / true: 既定の値 / false: 付けない
type HeaderValue = string | boolean;

/**
 * Options for {@link secureHeaders}. For each header: a string sets that value, `true` or omitted uses the default,
 * and `false` leaves the header out. Headers without a default are added only when given a string.
 */
export type SecureHeadersOptions = {
    // 既定では付けない(アプリごとに中身が違い、合わないとページが壊れるため)
    /** `Content-Security-Policy`. No default; added only when given a string. */
    contentSecurityPolicy?: HeaderValue;
    // 既定では付けない(よそのオリジンの画像なども読めなくなるため)
    /** `Cross-Origin-Embedder-Policy`. No default; added only when given a string. */
    crossOriginEmbedderPolicy?: HeaderValue;
    /** `Cross-Origin-Opener-Policy`. Default `"same-origin"`. */
    crossOriginOpenerPolicy?: HeaderValue;
    /** `Cross-Origin-Resource-Policy`. Default `"same-origin"`. */
    crossOriginResourcePolicy?: HeaderValue;
    /** `Origin-Agent-Cluster`. Default `"?1"`. */
    originAgentCluster?: HeaderValue;
    /** `Referrer-Policy`. Default `"no-referrer"`. */
    referrerPolicy?: HeaderValue;
    /** `Strict-Transport-Security`. Default `"max-age=15552000; includeSubDomains"`. */
    strictTransportSecurity?: HeaderValue;
    /** `X-Content-Type-Options`. Default `"nosniff"`. */
    xContentTypeOptions?: HeaderValue;
    /** `X-DNS-Prefetch-Control`. Default `"off"`. */
    xDnsPrefetchControl?: HeaderValue;
    /** `X-Download-Options`. Default `"noopen"`. */
    xDownloadOptions?: HeaderValue;
    /** `X-Frame-Options`. Default `"SAMEORIGIN"`. */
    xFrameOptions?: HeaderValue;
    /** `X-Permitted-Cross-Domain-Policies`. Default `"none"`. */
    xPermittedCrossDomainPolicies?: HeaderValue;
    // 古いブラウザの XSS フィルターは、かえって穴になるので "0"(切る)にする
    /** `X-XSS-Protection`. Default `"0"` (turns off the legacy XSS filter). */
    xXssProtection?: HeaderValue;
};

// [オプション名, ヘッダー名, 既定の値(null なら既定では付けない)]
const HEADERS: [keyof SecureHeadersOptions, string, string | null][] = [
    ["contentSecurityPolicy", "content-security-policy", null],
    ["crossOriginEmbedderPolicy", "cross-origin-embedder-policy", null],
    ["crossOriginOpenerPolicy", "cross-origin-opener-policy", "same-origin"],
    ["crossOriginResourcePolicy", "cross-origin-resource-policy", "same-origin"],
    ["originAgentCluster", "origin-agent-cluster", "?1"],
    ["referrerPolicy", "referrer-policy", "no-referrer"],
    ["strictTransportSecurity", "strict-transport-security", "max-age=15552000; includeSubDomains"],
    ["xContentTypeOptions", "x-content-type-options", "nosniff"],
    ["xDnsPrefetchControl", "x-dns-prefetch-control", "off"],
    ["xDownloadOptions", "x-download-options", "noopen"],
    ["xFrameOptions", "x-frame-options", "SAMEORIGIN"],
    ["xPermittedCrossDomainPolicies", "x-permitted-cross-domain-policies", "none"],
    ["xXssProtection", "x-xss-protection", "0"],
];

/**
 * Middleware that adds common security headers to responses. Headers already on the response are not overwritten,
 * and headers set with `c.header()` take precedence. Responses with a status below 200 are left unchanged.
 * Throws if `true` is given for a header without a default.
 *
 * @example
 * ```ts
 * import { createApp, secureHeaders } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(secureHeaders({ contentSecurityPolicy: "default-src 'self'", xFrameOptions: "DENY" }));
 * ```
 */
export function secureHeaders(options: SecureHeadersOptions = {}): Middleware {
    const headers: [string, string][] = [];
    for (const [key, name, fallback] of HEADERS) {
        const value = options[key];
        if (value === false) continue;
        if (typeof value === "string") headers.push([name, value]);
        else if (fallback !== null) headers.push([name, fallback]);
        else if (value === true) {
            throw new Error(`secureHeaders(): ${key} には既定の値がないので、文字列で指定してください`);
        }
    }

    return async function secureHeaders(c, next) {
        // next() のあとでレスポンスに足す。ハンドラーが Response に付けたものは上書きしない
        // (c.header() で付けたものは、このあと finalize() で入るので、そちらが勝つ)
        const downstream = await next();
        // 101(WebSocket のアップグレード)などは作り直すと壊れるので触らない(finalize() と同じ)
        if (downstream.status < 200) return downstream;
        const res = editable(downstream);
        for (const [name, value] of headers) {
            if (!res.headers.has(name)) res.headers.set(name, value);
        }
        return res;
    };
}
