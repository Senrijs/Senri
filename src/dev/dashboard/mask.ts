// ダッシュボードに出すヘッダーのうち、機密になりうるものを *** に伏せる
// (画面を人に見せたり、スクリーンショットを貼ったりしても漏れないように)

// 名前で決まっているもの
const SECRET_NAMES = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
// 名前にこれらを含むもの(x-api-key、x-auth-token、x-session-id など)
const SECRET_PATTERN = /token|secret|passw(or)?d|api[-_]?key|session|signature|credential/i;

export const MASK = "***";

export function isSecretHeader(name: string): boolean {
    const n = name.toLowerCase();
    return SECRET_NAMES.has(n) || SECRET_PATTERN.test(n);
}

// クエリ文字列("?token=abc&page=2")のうち、名前が機密っぽいパラメーターの値を *** にする
// (ヘッダーと同じ名前のルール。?token=... や ?api_key=... は、コールバックの URL などによく付く)
// URL を組み立て直すとエンコードが変わってしまうので、"名前=値" の値の部分だけを置き換える
export function maskQuery(search: string): string {
    if (search === "" || search === "?") return search;
    const pairs = search.replace(/^\?/, "").split("&");
    const masked = pairs.map((pair) => {
        const eq = pair.indexOf("=");
        // 値のないもの("?debug")は伏せるものがない
        if (eq === -1) return pair;
        const rawName = pair.slice(0, eq);
        let name = rawName;
        try {
            name = decodeURIComponent(rawName.replaceAll("+", " "));
        } catch {
            // デコードできない名前は、そのままの形で判定する
        }
        return isSecretHeader(name) ? `${rawName}=${MASK}` : pair;
    });
    return `?${masked.join("&")}`;
}

// [名前, 値] の配列(名前の順)。Set-Cookie は1つずつ並ぶので、何個付いたかは分かる
export function maskHeaders(headers: Headers): [string, string][] {
    const out: [string, string][] = [];
    for (const [name, value] of headers) {
        out.push([name, isSecretHeader(name) ? MASK : value]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
}
