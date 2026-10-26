// よく使われるセキュリティ系のレスポンスヘッダーをまとめて付ける
import type { Middleware } from "../context.ts";
import { editable } from "./response.ts";

// 文字列: その値にする / true: 既定の値 / false: 付けない
type HeaderValue = string | boolean;

export type SecureHeadersOptions = {
    // 既定では付けない(アプリごとに中身が違い、合わないとページが壊れるため)
    contentSecurityPolicy?: HeaderValue;
    // 既定では付けない(よそのオリジンの画像なども読めなくなるため)
    crossOriginEmbedderPolicy?: HeaderValue;
    crossOriginOpenerPolicy?: HeaderValue;
    crossOriginResourcePolicy?: HeaderValue;
    originAgentCluster?: HeaderValue;
    referrerPolicy?: HeaderValue;
    strictTransportSecurity?: HeaderValue;
    xContentTypeOptions?: HeaderValue;
    xDnsPrefetchControl?: HeaderValue;
    xDownloadOptions?: HeaderValue;
    xFrameOptions?: HeaderValue;
    xPermittedCrossDomainPolicies?: HeaderValue;
    // 古いブラウザの XSS フィルターは、かえって穴になるので "0"(切る)にする
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
