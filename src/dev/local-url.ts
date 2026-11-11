// URL のホスト名が localhost か。公開しない部品(0.3.0 で @senrijs/senri/dev から外した。意図せず公開していたもの)

// request.url のホスト名が localhost か(Host や X-Forwarded-Host などのヘッダーは見ない。だれでも付けられるので)
// - Workers: Cloudflare は登録されたドメインのリクエストしか渡さないので、本番に localhost は来ない。wrangler dev は localhost
// - ブラウザ: Service Worker が受けるリクエストの URL は、そのサイトのオリジン。開発中だけ localhost になる
/**
 * Whether the URL's host is `localhost`, `*.localhost`, `[::1]` or `127.x.x.x`.
 * Only the URL is checked, not headers such as `Host`. Returns `false` for an invalid URL.
 */
export function isLocalUrl(url: string): boolean {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }
    return (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "[::1]" ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
}
