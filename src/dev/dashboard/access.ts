// ダッシュボード(/_senri)を開いてよいリクエストかを決める
//
// ダッシュボードには、リクエストのヘッダーやエラーの中身(ソースコード)が出るので、
// 同じ PC(ループバック)からのアクセスだけに絞る。そのために接続元のアドレスが要るが、
// Web 標準の Request には入っていないので、app.fetch の2つ目の引数から取り出す:
// - Bun:  Bun.serve({ fetch: app.fetch }) は server を渡す → server.requestIP(req)
// - Deno: Deno.serve(app.fetch) は info を渡す → info.remoteAddr.hostname
// - Node: senri/node のアダプターが Deno と同じ形 { remoteAddr: { hostname } } で渡す
// 型ではなく「形」で見分けるので、Cloudflare Workers の fetch(req, env, ctx) の env のような
// 別のものが来ても壊れず、「接続元不明」になる(ダッシュボードだけ拒否し、ほかは普通に動く)

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

// 127.0.0.0/8 と ::1(IPv4 を IPv6 の形で書いた ::ffff:127.x.x.x も)
export function isLoopback(address: string | null): boolean {
    if (!address) return false;
    const a = address.toLowerCase().replace(/^\[|\]$/g, "");
    if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
    const v4 = a.startsWith("::ffff:") ? a.slice("::ffff:".length) : a;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

// Host ヘッダーが localhost 系か(DNS リバインディング対策)
// 悪意のあるサイトが自分のドメインを 127.0.0.1 に向けると、ブラウザは接続元がループバックのまま
// Host: evil.example でアクセスしてくる。接続元だけでなく Host も見ることで、これを防ぐ
export function isLocalHost(host: string | null): boolean {
    if (!host) return false;
    const h = host.toLowerCase();
    if (h === "[::1]" || h.startsWith("[::1]:")) return true;
    const name = h.replace(/:\d+$/, "");
    return name === "localhost" || name.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

export function canOpenDashboard(req: Request, info: unknown): boolean {
    return isLoopback(remoteAddress(req, info)) && isLocalHost(req.headers.get("host"));
}

// 状態を変えるリクエスト(クリアなど)は、ダッシュボード自身のページから来たものだけ受け付ける
// (ほかのサイトのページから、こっそり POST させられないように)
export function sameOrigin(req: Request): boolean {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (!origin || !host) return false;
    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}
