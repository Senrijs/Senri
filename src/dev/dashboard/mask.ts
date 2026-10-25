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

// [名前, 値] の配列(名前の順)。Set-Cookie は1つずつ並ぶので、何個付いたかは分かる
export function maskHeaders(headers: Headers): [string, string][] {
    const out: [string, string][] = [];
    for (const [name, value] of headers) {
        out.push([name, isSecretHeader(name) ? MASK : value]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
}
