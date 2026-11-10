/**
 * Access the current request's context (`c`) from anywhere in the code that handles it, such as a database helper
 * or a logger, without passing `c` down. Uses `AsyncLocalStorage` from `node:async_hooks`.
 *
 * - Bun, Deno and Node.js: works as is
 * - Cloudflare Workers: needs `node:async_hooks`. Add the `nodejs_als` (or `nodejs_compat`) compatibility flag to your
 *   wrangler configuration; with older compatibility dates the Worker does not start without it ("No such module").
 *   If you bundle the Worker yourself instead of with wrangler, keep `node:*` imports external
 * - Browsers (Service Worker): not available. This entry imports `node:async_hooks`, which browsers do not have;
 *   pass `c` as an argument there instead
 *
 * Code that keeps running after the response (a timer started in a handler) still sees that request's `c`, as is usual
 * with `AsyncLocalStorage`: do not keep using it there.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { contextStorage, getContext } from "@senrijs/senri/context-storage";
 *
 * function currentUserAgent() {
 *     return getContext().req.headers.get("user-agent");
 * }
 *
 * const app = createApp();
 * app.use(contextStorage());
 * app.get("/", () => `You are using ${currentUserAgent()}`);
 * ```
 *
 * @module
 */
// どこからでも、いま処理しているリクエストの c を取れるようにする(c を引数で渡していかなくてよい)
// AsyncLocalStorage(node:async_hooks)を使う。Bun・Deno・Node.js はそのまま、Workers は nodejs_als か nodejs_compat のフラグを付ける
// (workerd 1.20261010 で、compatibility date が 2026-10-01 ならフラグなしでも動き、2024-06-01 では "No such module" で起動しなかった)
// ブラウザには node:async_hooks がないので使えない。await をまたぐと別のリクエストの c を返しかねないので、代わりの仕組みは作らない
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, Middleware } from "../../src/index.ts";
import { senriError } from "../../src/errors.ts";
import { markPlainSafe } from "../../src/plain.ts";

// アプリがいくつあっても、1 つでよい(リクエストごとに run するので混ざらない)
const storage = new AsyncLocalStorage<Context>();

/**
 * Middleware that makes `c` available through {@link getContext} for the rest of the request: in later middleware,
 * the handler, `onError` for errors thrown after it, and anything they call, including code that runs after an
 * `await` or in a stream. Register it first so that it covers everything.
 * See the module documentation for the runtimes it works on.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { contextStorage } from "@senrijs/senri/context-storage";
 *
 * const app = createApp();
 * app.use(contextStorage());
 * ```
 */
export function contextStorage(): Middleware {
    return markPlainSafe<Middleware>(function contextStorage(c, next) {
        return storage.run(c, next);
    });
}

/**
 * Returns the context of the request being handled. Throws an `Error` (`code: "no_context"`) when called outside a
 * request covered by {@link contextStorage}: at startup, in a timer started outside a request, or when
 * `contextStorage()` is not registered (or registered after the middleware that calls this).
 *
 * @example
 * ```ts
 * import { getContext } from "@senrijs/senri/context-storage";
 *
 * export function requestPath(): string {
 *     return getContext().path;
 * }
 * ```
 */
export function getContext<V extends object = any>(): Context<V> {
    const c = storage.getStore();
    if (c === undefined) {
        throw senriError("no_context", "getContext() was called outside a request. Register app.use(contextStorage()) first");
    }
    return c as Context<V>;
}

/** Like {@link getContext}, but returns `undefined` outside a request instead of throwing. */
export function tryGetContext<V extends object = any>(): Context<V> | undefined {
    return storage.getStore() as Context<V> | undefined;
}
