// 接続元のアドレスを、app.fetch の2つ目の引数から取り出す(c.ip と、ダッシュボードの localhost 制限で使う)
//
// Web 標準の Request には接続元が入っていないので、ランタイムが渡すものから取る:
// - Bun:  Bun.serve({ fetch: app.fetch }) は server を渡す → server.requestIP(req)
// - Deno: Deno.serve(app.fetch) は info を渡す → info.remoteAddr.hostname
// - Node: senri/node のアダプターが Deno と同じ形 { remoteAddr: { hostname } } で渡す
// 型ではなく「形」で見分けるので、Cloudflare Workers の fetch(req, env, ctx) の env のような
// 別のものが来ても壊れず、「接続元不明」(null)になる

import { isWorkers } from "./runtime.ts";

type BunServerLike = { requestIP(req: Request): { address: string } | null };
type DenoInfoLike = { remoteAddr: { hostname: string } };

export function remoteAddress(req: Request, info: unknown): string | null {
    try {
        if (typeof info !== "object" || info === null) return null;
        const bun = info as Partial<BunServerLike>;
        if (typeof bun.requestIP === "function") {
            const address = bun.requestIP(req)?.address;
            return typeof address === "string" ? address : null;
        }
        const deno = info as Partial<DenoInfoLike>;
        const hostname = typeof deno.remoteAddr === "object" && deno.remoteAddr !== null ? deno.remoteAddr.hostname : undefined;
        return typeof hostname === "string" ? hostname : null;
    } catch {
        // プロパティを読んだだけで例外を投げるような値でも、壊れずに「不明」にする
        return null;
    }
}

// Bun の server か、Deno の info(Node のアダプターも同じ形)か。そうでなければ Workers の env などほかのもの
export function isConnectionInfo(info: unknown): boolean {
    try {
        if (typeof info !== "object" || info === null) return false;
        const value = info as { requestIP?: unknown; remoteAddr?: unknown };
        return typeof value.requestIP === "function" || (typeof value.remoteAddr === "object" && value.remoteAddr !== null);
    } catch {
        return false;
    }
}

// c.ip 用。IPv4 を IPv6 の形で書いたもの(::ffff:192.0.2.1)は IPv4 にそろえる
// Cloudflare Workers には接続元を渡す引数がないので、Cloudflare が付ける CF-Connecting-IP を読む
// (Cloudflare を通ったリクエストでは、クライアントが送った同名のヘッダーは Cloudflare が上書きする)
export function clientIp(req: Request, info: unknown): string | null {
    const address = remoteAddress(req, info) ?? (isWorkers() ? req.headers.get("cf-connecting-ip") : null);
    if (address === null) return null;
    const lower = address.toLowerCase();
    return lower.startsWith("::ffff:") && lower.includes(".") ? address.slice("::ffff:".length) : address;
}
