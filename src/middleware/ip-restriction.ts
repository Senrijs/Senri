// IP アドレスで、通す相手と拒否する相手を決める
import type { Context, Middleware } from "../context.ts";
import { HttpError, senriError } from "../errors.ts";
import { inRange, parseIp, parseRange, type IpRange } from "../ip-address.ts";
import { getIp } from "../ip.ts";
import { markPlainSafe } from "../plain.ts";

/** Options for {@link ipRestriction}. At least one of `allow` and `deny` is required. */
export type IpRestrictionOptions = {
    // 指定したら、この中のアドレスだけを通す(空の配列なら、誰も通さない)
    /** Only these addresses may pass, as IPs or CIDR ranges (`"10.0.0.0/8"`, `"2001:db8::/32"`). An empty array lets nobody pass. */
    allow?: readonly string[];
    // allow より優先する
    /** These addresses are rejected, as IPs or CIDR ranges. Takes priority over `allow`. */
    deny?: readonly string[];
    // クライアントの IP を返す関数。プロキシの後ろでは trustProxy() で作った関数を渡す
    /** Returns the client's IP. Default `getIp`. Behind a proxy, pass a function made with `trustProxy()`. */
    ip?: (c: Context) => string | null;
    // IP が分からないリクエストを通すか。テスト用
    /** Let requests through when the IP is not known, as when tests call `app.fetch` directly. Default `false`: they get 403. */
    allowUnknown?: boolean;
};

function parseRanges(list: readonly string[] | undefined): IpRange[] | null {
    if (list === undefined) return null;
    if (!Array.isArray(list)) throw senriError("ip_restriction_range", "ipRestriction(): invalid range");
    return list.map((text: string) => {
        const range = typeof text === "string" ? parseRange(text) : null;
        if (range === null) throw senriError("ip_restriction_range", `ipRestriction(): invalid range: ${text}`);
        return range;
    });
}

/**
 * Middleware that allows or rejects requests by IP address, for IPv4 and IPv6, with CIDR ranges. `deny` is checked first.
 * A rejected request gets 403 by throwing an `HttpError`, so `app.onError` can change the body.
 *
 * - If the IP is not known, the request gets 403 even with only `deny`, since it cannot be shown to be safe. Set
 *   `allowUnknown` for tests that call `app.fetch` directly
 * - Behind a proxy, every request comes from the proxy's address: pass `ip` made with `trustProxy()`
 * - IPv4 and IPv6 are separate: `"0.0.0.0/0"` does not cover IPv6 addresses. `::ffff:192.0.2.1` counts as `192.0.2.1`
 *
 * Throws when neither `allow` nor `deny` is given, or a range cannot be read.
 *
 * @example
 * ```ts
 * import { createApp, ipRestriction } from "@senrijs/senri";
 * import { trustProxy } from "@senrijs/senri/ip";
 *
 * const app = createApp();
 * app.use("/admin", ipRestriction({ allow: ["192.0.2.0/24", "2001:db8::/32"], deny: ["192.0.2.13"] }));
 *
 * // Behind one proxy:
 * app.use("/internal", ipRestriction({ allow: ["10.0.0.0/8"], ip: trustProxy({ hops: 1 }) }));
 * ```
 */
export function ipRestriction(options: IpRestrictionOptions): Middleware {
    const allow = parseRanges(options.allow);
    const deny = parseRanges(options.deny);
    if (allow === null && deny === null) throw senriError("ip_restriction_options", "ipRestriction(): allow or deny is required");
    const resolve = options.ip ?? getIp;

    return markPlainSafe<Middleware>(async function ipRestriction(c, next) {
        const text = resolve(c);
        const ip = text === null ? null : parseIp(text);
        if (ip === null) {
            if (options.allowUnknown === true) return next();
            throw new HttpError(403, "403 Forbidden");
        }
        const matches = (range: IpRange) => inRange(ip, range);
        if (deny?.some(matches) || (allow !== null && !allow.some(matches))) throw new HttpError(403, "403 Forbidden");
        return next();
    });
}
