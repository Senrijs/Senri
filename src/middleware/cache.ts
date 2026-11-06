// キャッシュについてのヘッダーを付ける
import type { Middleware } from "../context.ts";
import { senriError } from "../errors.ts";
import { markPlainSafe, methodOf } from "../plain.ts";
import { appendVary, editable } from "./response.ts";

/** Options for {@link cache}. */
export type CacheOptions = {
    /** The `Cache-Control` header value, such as `"public, max-age=3600"`. */
    cacheControl: string;
    /** Header names to add to `Vary`, such as `["Accept-Language"]`. */
    vary?: readonly string[];
};

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Middleware that adds `Cache-Control`, and `Vary` if given, to `GET` and `HEAD` responses with a 2xx status. It only sets
 * these headers: browsers and CDNs do the caching.
 *
 * - A `Cache-Control` already on the `Response` is kept, and one set with `c.header()` wins, so a route can use its own
 * - **Be careful with `public`:** a shared cache could give one user's page to another. This middleware cannot see cookies
 *   set with `setCookie()`, so do not use `public` on paths with personal pages. Use it with a path, as in the example
 *
 * Throws when `cacheControl` is empty or has characters that cannot be sent in a header, or `vary` has an invalid name.
 *
 * @example
 * ```ts
 * import { cache, createApp } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use("/assets", cache({ cacheControl: "public, max-age=3600" }));
 * app.use("/account", cache({ cacheControl: "private, no-store" }));
 * ```
 */
export function cache(options: CacheOptions): Middleware {
    const { cacheControl, vary = [] } = options;
    const valid =
        typeof cacheControl === "string" &&
        /^[\x20-\x7e]+$/.test(cacheControl) &&
        Array.isArray(vary) &&
        vary.every((name: unknown) => typeof name === "string" && HEADER_NAME.test(name));
    if (!valid) throw senriError("cache_options", "cache(): invalid options");

    return markPlainSafe<Middleware>(async function cache(c, next) {
        const method = methodOf(c);
        const res = await next();
        if ((method !== "GET" && method !== "HEAD") || res.status < 200 || res.status > 299) return res;
        const out = editable(res);
        if (!out.headers.has("cache-control")) out.headers.set("cache-control", cacheControl);
        if (vary.length > 0) appendVary(out.headers, ...vary);
        return out;
    });
}
