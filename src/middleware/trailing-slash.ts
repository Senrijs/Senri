// 末尾のスラッシュを正規の形にそろえる(/a と /a/ は同じルートなので、検索エンジン向け)
import type { Middleware, RedirectStatus } from "../context.ts";
import { senriError } from "../errors.ts";
import { markPlainSafe, methodOf, urlOf } from "../plain.ts";
import { pathnameOf } from "../router.ts";

/** Options for {@link trailingSlash}. */
export type TrailingSlashOptions = {
    /** `"remove"` redirects `/a/` to `/a`, and `"add"` redirects `/a` to `/a/`. Default `"remove"`. */
    mode?: "remove" | "add";
    /** The redirect status, `301` or `308`. Default `301`. */
    status?: 301 | 308;
};

/**
 * Middleware that redirects to one form of a path, with or without the trailing slash. Senri routes `/a` and `/a/` the same
 * way, so this is only for having one canonical URL, as search engines prefer. The query string is kept.
 *
 * It redirects only:
 * - `GET` and `HEAD` requests
 * - Paths that match a route, so unknown paths stay 404 and `serveStatic()` directories keep working
 *
 * It leaves these as they are:
 * - The root path `/`
 * - With `"add"`, paths whose last segment has a `.`, such as `/sitemap.xml`
 * - Paths that start with `//`, which browsers would read as another site
 *
 * Throws when `mode` or `status` is not one of the values above.
 *
 * @example
 * ```ts
 * import { createApp, trailingSlash } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(trailingSlash());
 * app.get("/about", () => "About"); // /about/ redirects to /about
 *
 * // Or the other way: app.use(trailingSlash({ mode: "add" }));
 * ```
 */
export function trailingSlash(options: TrailingSlashOptions = {}): Middleware {
    const mode = options.mode ?? "remove";
    const status: RedirectStatus = options.status ?? 301;
    if ((mode !== "remove" && mode !== "add") || (status !== 301 && status !== 308)) {
        throw senriError("trailing_slash_options", "trailingSlash(): invalid options");
    }

    return markPlainSafe<Middleware>(async function trailingSlash(c, next) {
        const method = methodOf(c);
        if ((method !== "GET" && method !== "HEAD") || c.route === undefined) return next();
        const url = urlOf(c);
        const path = pathnameOf(url);
        if (path === "/" || path.startsWith("//")) return next();
        let target: string;
        if (mode === "remove") {
            if (!path.endsWith("/")) return next();
            target = path.replace(/\/+$/, "");
        } else {
            if (path.endsWith("/") || path.slice(path.lastIndexOf("/")).includes(".")) return next();
            target = `${path}/`;
        }
        const query = url.indexOf("?");
        return c.redirect(query === -1 ? target : target + url.slice(query), status);
    });
}
