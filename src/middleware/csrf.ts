// CSRF 対策(よそのサイトのページから、ログイン中の利用者になりすまして POST などを送らせない)
// トークンは使わず、ブラウザが付ける Sec-Fetch-Site と Origin で判定する(Go の net/http の CrossOriginProtection と同じ考え方)
import type { Context, Middleware } from "../context.ts";
import { HttpError, senriError } from "../errors.ts";
import { headerOf, markPlainSafe, methodOf, urlOf } from "../plain.ts";

/** Options for {@link csrf}. */
export type CsrfOptions = {
    // よそのオリジンでも通すもの("https://admin.example.com" の形。末尾の / やパスは付けない)
    /**
     * Other origins allowed to send requests, such as `"https://admin.example.com"` (scheme, host and port only),
     * or a function that decides. Requests from the same origin are always allowed.
     */
    origin?: string | readonly string[] | ((origin: string, c: Context) => boolean);
};

// 状態を変えないメソッド。これらは確かめない
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function originMatcher(origin: CsrfOptions["origin"]): (value: string, c: Context) => boolean {
    if (origin === undefined) return () => false;
    if (typeof origin === "function") return (value, c) => origin(value, c) === true;
    const list = typeof origin === "string" ? [origin] : origin;
    if (!Array.isArray(list) || list.some((o) => typeof o !== "string" || !/^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]+$/i.test(o))) {
        throw senriError("csrf_origin", new TypeError('csrf(): origin must be like "https://example.com" (no path or trailing slash)'));
    }
    const allowed = new Set(list.map((o) => o.toLowerCase()));
    return (value) => allowed.has(value.toLowerCase());
}

// Origin のホスト(とポート)が、リクエストのホストと同じか
// スキームは比べない(TLS を終えるプロキシの後ろでは、アプリから見たリクエストが http になるため。Go と同じ)
function sameHost(origin: string, c: Context): boolean {
    let originHost: string;
    try {
        originHost = new URL(origin).host;
    } catch {
        return false;
    }
    const host = headerOf(c, "host") ?? new URL(urlOf(c)).host;
    return originHost !== "" && originHost === host.toLowerCase();
}

/**
 * Middleware that protects against cross-site request forgery (CSRF), without tokens. For methods other than GET, HEAD
 * and OPTIONS, it rejects requests that a browser sent from another origin, with 403 (an `HttpError`, so `app.onError`
 * can change the body). It decides from headers that browsers add and pages cannot change, as Go's
 * `CrossOriginProtection` does:
 * - `Sec-Fetch-Site: same-origin` or `none` (typed in the address bar, bookmarks) is allowed; other values are rejected
 *   unless `Origin` is in `origin`
 * - Without `Sec-Fetch-Site` (older browsers), `Origin` is compared with the `Host` header (host and port; the scheme is
 *   not compared, so it works behind a proxy that ends TLS)
 * - Without either header, the request is allowed: it did not come from a browser (curl, server-to-server calls), and
 *   such clients cannot be made to send a user's cookies by another site
 *
 * Keep GET and HEAD free of side effects: they are not checked. Requests from other sites that you want to accept
 * (your other domains, or webhooks sent by browsers) need `origin`.
 * Throws a `TypeError` if an `origin` string is not like `"https://example.com"`.
 *
 * @example
 * ```ts
 * import { createApp, csrf } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(csrf());
 * // Also accept forms posted from another of your sites:
 * app.use("/api", csrf({ origin: ["https://admin.example.com"] }));
 * ```
 */
export function csrf(options: CsrfOptions = {}): Middleware {
    const trusted = originMatcher(options.origin);

    return markPlainSafe<Middleware>(async function csrf(c, next) {
        if (SAFE.has(methodOf(c))) return next();
        const origin = headerOf(c, "origin");
        const site = headerOf(c, "sec-fetch-site");
        if (site !== null) {
            if (site === "same-origin" || site === "none") return next();
        } else if (origin === null || sameHost(origin, c)) {
            return next();
        }
        if (origin !== null && trusted(origin, c)) return next();
        throw senriError("csrf_rejected", new HttpError(403, "403 Forbidden"));
    });
}
