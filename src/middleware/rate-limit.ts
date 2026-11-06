// リクエストの数を制限する(固定ウィンドウ)
import type { Context, Middleware } from "../context.ts";
import { HttpError, senriError } from "../errors.ts";
import { parseIp } from "../ip-address.ts";
import { getIp } from "../ip.ts";
import { markPlainSafe } from "../plain.ts";

/** The state of a key in a {@link RateLimitStore}. */
export type RateLimitEntry = {
    /** How many requests the current window has, including this one. */
    count: number;
    /** When the window ends, in milliseconds since the epoch. */
    resetAt: number;
};

// 保存先。Redis の INCR と PEXPIRE のように、1回で数えて返す。同時に来ても数え漏らさないようにするのは保存先の役目
/**
 * Where {@link rateLimit} keeps its counts. To use Redis or similar, implement this one method: add 1 to the key, starting
 * a window of `windowMs` if there is none, and return the result. It decides the algorithm, so a store may use a sliding
 * window. It should count atomically; Workers KV cannot, so it only limits approximately.
 */
export type RateLimitStore = {
    /** Adds 1 to `key` and returns its state. */
    increment(key: string, windowMs: number): RateLimitEntry | Promise<RateLimitEntry>;
};

/** Options for {@link rateLimit}. */
export type RateLimitOptions = {
    /** The length of the window, in milliseconds. */
    windowMs: number;
    /** How many requests each key may make in a window. */
    limit: number;
    // クライアントの IP を返す関数。プロキシの後ろでは trustProxy() で作った関数を渡す
    /** Returns the client's IP. Default `getIp`. Behind a proxy, pass a function made with `trustProxy()`. */
    ip?: (c: Context) => string | null;
    // 数える単位。null を返すと制限しない
    /**
     * Returns what to count by, such as a user ID, instead of the IP. Requests with the same key share a limit, and
     * `null` lets the request through without counting it.
     */
    key?: (c: Context) => string | null | Promise<string | null>;
    /** Where to keep the counts. Default: in memory, in this process. */
    store?: RateLimitStore;
    // メモリの保存先の上限
    /** The most keys the default store holds. When full, the oldest key is forgotten. Default `100000`. Ignored with `store`. */
    maxKeys?: number;
    /** Send the `RateLimit` and `RateLimit-Policy` headers (IETF draft). `Retry-After` is always sent on 429. Default `true`. */
    headers?: boolean;
};

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

// メモリの保存先。タイマーは使わない(Workers はグローバルで使えず、Node ではプロセスが終わらなくなる)
// Map は入れた順に並ぶ。ウィンドウの長さが同じなので、古いものから順に期限が切れる
export function memoryStore(maxKeys: number): RateLimitStore {
    const entries = new Map<string, RateLimitEntry>();
    return {
        increment(key, windowMs) {
            const now = Date.now();
            for (const [oldest, entry] of entries) {
                if (entry.resetAt > now) break;
                entries.delete(oldest);
            }
            let entry = entries.get(key);
            if (entry === undefined) {
                // いっぱいなら、いちばん古いものを忘れる(メモリが増え続けないように)
                if (entries.size >= maxKeys) entries.delete(entries.keys().next().value!);
                entry = { count: 0, resetAt: now + windowMs };
                entries.set(key, entry);
            }
            entry.count++;
            return entry;
        },
    };
}

// IP を数える単位にする。IPv6 は /64 ごとにまとめる(1 人が /64 をまるごと持てるので、アドレスを変えれば逃れられる)
function ipKey(text: string | null): string | null {
    if (text === null) return null;
    const bytes = parseIp(text);
    if (bytes === null) return null;
    if (bytes.length === 4) return bytes.join(".");
    return `${Array.from(bytes.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("")}/64`;
}

/**
 * Middleware that limits how many requests each client can make in a window. Over the limit, it responds with 429 and
 * `Retry-After` by throwing an `HttpError`, so `app.onError` can change the body. Every request counts.
 *
 * - **Algorithm:** a fixed window that starts at a key's first request. A client can reach up to twice `limit` around
 *   the end of a window
 * - **Key:** the IP by default, with IPv6 addresses grouped by /64. If the IP is not known, the request is let through
 *   and a warning is logged once: putting those requests together would let one client stop all of them. Behind a proxy,
 *   every request comes from the proxy's address, so pass `ip` made with `trustProxy()`
 * - **Memory:** the default store is in this process. Expired keys are removed on later requests, and it holds at most
 *   `maxKeys` keys. Each process has its own counts, so several processes each allow `limit`
 * - **Cloudflare Workers:** memory belongs to each isolate, so the default store does not limit across isolates. Use a
 *   `store` backed by a Durable Object, or Cloudflare's rate limiting. Workers KV cannot count atomically
 * - **Store errors** reach `app.onError`. To let requests through when the store is down, catch them in your `store`
 *
 * Throws when `windowMs`, `limit` or `maxKeys` is not a positive number, or `store` has no `increment` method.
 *
 * @example
 * ```ts
 * import { createApp, rateLimit } from "@senrijs/senri";
 * import { trustProxy } from "@senrijs/senri/ip";
 *
 * const app = createApp();
 * app.use(rateLimit({ windowMs: 60_000, limit: 100 }));
 *
 * // Behind one proxy:
 * // app.use(rateLimit({ windowMs: 60_000, limit: 100, ip: trustProxy({ hops: 1 }) }));
 *
 * // By user instead of by IP:
 * // app.use(rateLimit({ windowMs: 60_000, limit: 100, key: (c) => c.get("userId") ?? null }));
 * ```
 */
export function rateLimit(options: RateLimitOptions): Middleware {
    const { windowMs, limit, store: custom } = options;
    const maxKeys = options.maxKeys ?? 100_000;
    if (!positive(windowMs) || !Number.isInteger(limit) || limit <= 0 || !Number.isInteger(maxKeys) || maxKeys <= 0) {
        throw senriError("rate_limit_options", "rateLimit(): invalid options");
    }
    if (custom !== undefined && typeof custom.increment !== "function") throw senriError("rate_limit_options", "rateLimit(): invalid store");
    const store = custom ?? memoryStore(maxKeys);
    const ip = options.ip ?? getIp;
    const keyOf = options.key ?? ((c: Context) => ipKey(ip(c)));
    const headers = options.headers ?? true;
    const policy = `"default";q=${limit};w=${Math.max(Math.ceil(windowMs / 1000), 1)}`;
    let warned = false;

    return markPlainSafe<Middleware>(async function rateLimit(c, next) {
        const pending = keyOf(c);
        const key = pending instanceof Promise ? await pending : pending;
        if (key === null) {
            if (!warned && options.key === undefined) {
                warned = true;
                console.warn("rateLimit(): the client's IP is not known, so these requests are not limited");
            }
            return next();
        }
        const counted = store.increment(key, windowMs);
        const { count, resetAt } = counted instanceof Promise ? await counted : counted;
        const seconds = Math.max(Math.ceil((resetAt - Date.now()) / 1000), 1);
        if (headers) {
            c.header("ratelimit-policy", policy);
            c.header("ratelimit", `"default";r=${Math.max(limit - count, 0)};t=${seconds}`);
        }
        if (count > limit) throw new HttpError(429, "429 Too Many Requests", { headers: { "retry-after": String(seconds) } });
        return next();
    });
}
