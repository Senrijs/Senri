// 時間内に終わらなければ、待たずにエラーで返す
import type { Middleware } from "../context.ts";
import { HttpError, senriError } from "../errors.ts";
import { markPlainSafe } from "../plain.ts";

/** Options for {@link timeout}. */
export type TimeoutOptions = {
    // 時間切れのときのステータス。504 は Hono と同じ。過負荷として扱いたいなら 503
    /** The status of the error response. Default `504`. */
    status?: number;
};

// setTimeout に渡せる最大(これを超えると、すぐに発火してしまう)
const MAX_MS = 2 ** 31 - 1;

/**
 * Middleware that responds with an error when the rest of the chain does not finish within `ms` milliseconds.
 * It throws an `HttpError`, so `app.onError` can change the response. Register it first, to include other middleware.
 *
 * **It does not stop the work.** After the response is sent:
 * - Asynchronous work keeps running. An error thrown later still reaches `app.onError`
 * - `c.req.signal` is not aborted: it only reports that the client disconnected. To stop calls to other services,
 *   pass them a signal with its own limit, as in the example
 *
 * It also cannot help when:
 * - The handler blocks synchronously, such as a long loop: the timer cannot fire until it returns
 * - The body is a stream: only the time until `next()` returns counts, not the time spent sending the body
 *
 * Throws when `ms` is not a positive number of milliseconds, or `status` is not between 400 and 599.
 *
 * @param ms The time limit in milliseconds.
 * @param options `status`: the status of the error response. Default `504`.
 *
 * @example
 * ```ts
 * import { createApp, timeout } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(timeout(5000));
 *
 * app.get("/report", async (_, c) => {
 *     // Stops when the client disconnects, or after 4 seconds
 *     const signal = AbortSignal.any([c.req.signal, AbortSignal.timeout(4000)]);
 *     const res = await fetch("https://example.com/report", { signal });
 *     return res.text();
 * });
 * ```
 */
export function timeout(ms: number, options: TimeoutOptions = {}): Middleware {
    if (typeof ms !== "number" || !(ms > 0) || ms > MAX_MS) throw senriError("timeout_ms", "timeout(): invalid ms");
    const status = options.status ?? 504;
    if (!Number.isInteger(status) || status < 400 || status > 599) throw senriError("timeout_status", "timeout(): invalid status");
    const message = status === 504 ? "504 Gateway Timeout" : `${status} Timeout`;

    return markPlainSafe<Middleware>(async function timeout(_c, next) {
        let expired = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                expired = true;
                reject(new HttpError(status, message));
            }, ms);
        });
        const downstream = next();
        // 時間切れのあとに届いたレスポンスは誰も読まないので、ストリームを閉じる(Node の近道では本文が文字列)
        downstream.then(
            (res) => {
                if (expired && res instanceof Response) res.body?.cancel().catch(() => {});
            },
            () => {},
        );
        try {
            return await Promise.race([downstream, limit]);
        } finally {
            clearTimeout(timer);
        }
    });
}
