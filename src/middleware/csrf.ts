// CSRF 対策(よそのサイトのページから、ログイン中の利用者になりすまして POST などを送らせない)
// トークンは使わず、ブラウザが付ける Sec-Fetch-Site と Origin で判定する(Go の net/http の CrossOriginProtection と同じ考え方)
import type { Middleware } from "../context.ts";
import { HttpError, senriError } from "../errors.ts";
import { headerOf, markPlainSafe, methodOf } from "../plain.ts";
import { originMatcher, sameHost, type OriginOption } from "./origin.ts";

/** Options for {@link csrf}. */
export type CsrfOptions = {
    // よそのオリジンでも通すもの("https://admin.example.com" の形。末尾の / やパスは付けない)
    /**
     * Other origins allowed to send requests, such as `"https://admin.example.com"` (scheme, host and port only),
     * or a function that decides. Requests from the same origin are always allowed.
     */
    origin?: OriginOption;
};

// 状態を変えないメソッド。これらは確かめない
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

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
 * (your other domains, or webhooks sent by browsers) need `origin`. Give them to the one `csrf()` that covers those
 * paths: a second `csrf()` with `origin` does not help, since the first one has already rejected the request.
 * Throws a `TypeError` if an `origin` string is not like `"https://example.com"`.
 *
 * @example
 * ```ts
 * import { createApp, csrf } from "@senrijs/senri";
 *
 * const app = createApp();
 * // Same-origin requests, plus forms posted from another of your sites:
 * app.use(csrf({ origin: ["https://admin.example.com"] }));
 * ```
 */
export function csrf(options: CsrfOptions = {}): Middleware {
    const trusted = originMatcher(options.origin, "csrf_origin", "csrf()");

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
