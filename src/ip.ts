/**
 * The client's IP address, taken from what the runtime passes to `app.fetch`
 * (or `CF-Connecting-IP` on Cloudflare Workers).
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { getIp } from "@senrijs/senri/ip";
 *
 * const app = createApp();
 * app.get("/ip", (_, c) => getIp(c) ?? "unknown");
 * ```
 *
 * Behind a proxy, use {@link trustProxy}.
 *
 * @module
 */
// @senrijs/senri/ip の入口
// Context のメソッドにしないのは、使わないアプリのバンドルに入れないため(0.1 の c.ip)
import { connectionOf, type Context } from "./context.ts";
import { clientIp } from "./connection.ts";
import { senriError } from "./errors.ts";
import { inRange, normalizeIp, parseIp, parseRange } from "./ip-address.ts";
import { headerOf } from "./plain.ts";

// 接続元の IP アドレス。分からなければ null(app.fetch を直接呼んだときなど)
// - Bun / Deno / Node(senri/node): ランタイムが渡す接続元
// - Cloudflare Workers: Cloudflare が付ける CF-Connecting-IP
// X-Forwarded-For などのヘッダーは偽装できるので読まない。プロキシの後ろでは、プロキシが付けるヘッダーを自分で読む
/**
 * The client's IP address, or `null` if it is not known (for example, when `app.fetch` is called directly).
 * - Bun, Deno, `@senrijs/senri/node`: the address the runtime passes to `app.fetch`
 * - Cloudflare Workers: the `CF-Connecting-IP` header set by Cloudflare
 *
 * IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`) are returned as IPv4.
 * Headers such as `X-Forwarded-For` are not read, since clients can forge them; behind a proxy, use {@link trustProxy}.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { getIp } from "@senrijs/senri/ip";
 *
 * const app = createApp();
 * app.get("/ip", (_, c) => getIp(c) ?? "unknown");
 * ```
 */
export function getIp(c: Context): string | null {
    const { req, info } = connectionOf(c);
    return clientIp(req, info);
}

/** Options for {@link trustProxy}: the number of proxies (`hops`), or their addresses (`proxies`). */
export type TrustProxyOptions = {
    // プロキシが付けるヘッダー。"forwarded" のときは RFC 7239 の形で読む。ほかのヘッダーと混ぜて読まない
    /**
     * The header set by your proxy. Default `"X-Forwarded-For"`. `"Forwarded"` is read in the RFC 7239 format.
     * A header with one value, such as `"CF-Connecting-IP"`, also works. Only this header is read.
     */
    header?: string;
} & (
    | {
          // 自分の前にあるプロキシの数
          /**
           * How many proxies are in front of the app. The client is this many values from the right of the header.
           * If the app can also be reached without going through them, the header can be forged: use `proxies` then.
           */
          hops: number;
          proxies?: never;
      }
    | {
          hops?: never;
          // プロキシのアドレス。接続元がこの中にあるときだけ、ヘッダーを読む
          /**
           * The addresses of your proxies, as IPs or CIDR ranges. The header is read only when the connection comes from
           * one of them, and the client is the rightmost value that is not one of them.
           */
          proxies: readonly string[];
      }
);

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// Forwarded の for= を読む。ポートと角かっこを取る。for= がない要素は空にする(IP として読めないので、そこで止まる)
function forwardedValues(header: string): string[] {
    return header.split(",").map((element) => {
        const match = /(?:^|;)\s*for\s*=\s*(?:"([^"]*)"|([^;\s]*))/i.exec(element);
        const value = match?.[1] ?? match?.[2] ?? "";
        return /^\[(.*)\](?::\d+)?$/.exec(value)?.[1] ?? /^([\d.]+):\d+$/.exec(value)?.[1] ?? value;
    });
}

/**
 * Makes a function that returns the client's IP address behind a proxy, or `null` if the header has a value that is not
 * an IP address. Pass it to `ipRestriction()` and `rateLimit()` as `ip`, so they all agree on the client.
 *
 * The first value of `X-Forwarded-For` is never trusted, since the client chooses it: proxies add to the right. Without
 * the header, it returns what {@link getIp} returns. `getIp()` itself never reads these headers.
 *
 * On Cloudflare Workers you do not need this: `getIp()` already reads `CF-Connecting-IP`, which Cloudflare sets.
 * Throws when the options are invalid. Use exactly one of `hops` and `proxies`.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { trustProxy } from "@senrijs/senri/ip";
 *
 * // One proxy, such as nginx or a load balancer:
 * const clientIp = trustProxy({ hops: 1 });
 * // Or by address, which also works if the app can be reached directly:
 * // const clientIp = trustProxy({ proxies: ["10.0.0.0/8"] });
 *
 * const app = createApp();
 * app.get("/ip", (_, c) => clientIp(c) ?? "unknown");
 * ```
 */
export function trustProxy(options: TrustProxyOptions): (c: Context) => string | null {
    const { hops, proxies } = options;
    const ranges = Array.isArray(proxies) ? proxies.map((proxy: string) => parseRange(proxy)) : undefined;
    const valid =
        proxies !== undefined
            ? hops === undefined && ranges !== undefined && ranges.length > 0 && ranges.every((range) => range !== null)
            : Number.isInteger(hops) && hops! > 0;
    const header = options.header ?? "X-Forwarded-For";
    if (!valid || !HEADER_NAME.test(header)) throw senriError("trust_proxy_options", "trustProxy(): invalid options");
    const name = header.toLowerCase();

    return (c) => {
        const peer = getIp(c);
        if (ranges) {
            const address = peer === null ? null : parseIp(peer);
            const trusted = (ip: Uint8Array) => ranges.some((range) => inRange(ip, range!));
            // 信頼するプロキシから来ていなければ、ヘッダーは誰でも書ける
            if (address === null || !trusted(address)) return peer;
        }
        const value = headerOf(c, name);
        if (value === null) return peer;
        const values = name === "forwarded" ? forwardedValues(value) : value.split(",").map((v) => v.trim());
        if (hops !== undefined) {
            // 数より短ければ、外側のプロキシを通っていない。残っている左端は、内側のプロキシが付けたもの
            return normalizeIp(values[Math.max(values.length - hops, 0)]!);
        }
        for (let i = values.length - 1; i >= 0; i--) {
            const bytes = parseIp(values[i]!);
            if (bytes === null) return null;
            if (i === 0 || !ranges!.some((range) => inRange(bytes, range!))) return normalizeIp(values[i]!);
        }
        return null;
    };
}
