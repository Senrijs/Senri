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
 * @module
 */
// @senrijs/senri/ip の入口
// Context のメソッドにしないのは、使わないアプリのバンドルに入れないため(0.1 の c.ip)
import { connectionOf, type Context } from "./context.ts";
import { clientIp } from "./connection.ts";

// 接続元の IP アドレス。分からなければ null(app.fetch を直接呼んだときなど)
// - Bun / Deno / Node(senri/node): ランタイムが渡す接続元
// - Cloudflare Workers: Cloudflare が付ける CF-Connecting-IP
// X-Forwarded-For などのヘッダーは偽装できるので読まない。プロキシの後ろでは、プロキシが付けるヘッダーを自分で読む
export function getIp(c: Context): string | null {
    const { req, info } = connectionOf(c);
    return clientIp(req, info);
}
