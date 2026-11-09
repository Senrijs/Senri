// 404 の「もしかして」: 打ち間違えたパスに、いちばん近いページを探す(ブラウザで動かす。静的書き出しなのでサーバーはない)
// - 比べる前に、小文字にして、最後の / と .html を外し、%xx を戻す
//   (Cloudflare は大文字小文字を区別するので、/Docs/Routing/... はそのままでは 404 になる。正しいページを勧める)
// - 近さは、パス全体の編集距離(隣の2文字の入れ替えも1つと数える)と、最後の区切りどうしの編集距離 + 1 の小さいほう
//   最後の区切りどうしは、十分に似ているときだけ使う(/routing/routes → /docs/routing/routes のような間違いを拾い、
//   関係ないページは勧めないため)
// - パスの長さに応じた上限より遠ければ、出さない
// - 候補は [比べるパス, 勧めるページ] の組。章のフォルダー(/docs/routing/)は、その章の最初のページを勧める

export type Candidate = [match: string, href: string];

export function normalizePath(path: string): string {
    let p = path;
    try {
        p = decodeURI(p);
    } catch {
        // 壊れた %xx はそのまま比べる
    }
    p = p.toLowerCase().replace(/\/{2,}/g, "/").replace(/\.html$/, "").replace(/\/index$/, "");
    if (p.length > 1) p = p.replace(/\/+$/, "");
    return p || "/";
}

// 編集距離(optimal string alignment: 挿入・削除・置き換え・隣の2文字の入れ替えを、それぞれ1つと数える)
export function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    let prev2: number[] = [];
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
            cur.push(d);
        }
        prev2 = prev;
        prev = cur;
    }
    return prev[n]!;
}

const lastSegment = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function suggest(path: string, candidates: Candidate[]): string | null {
    const target = normalizePath(path);
    if (target === "/") return null;
    const last = lastSegment(target);
    let best: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [match, href] of candidates) {
        const c = normalizePath(match);
        const whole = editDistance(target, c);
        const cLast = lastSegment(c);
        let byLast = Number.POSITIVE_INFINITY;
        if (last && cLast) {
            const d = editDistance(last, cLast);
            if (d <= Math.max(1, Math.floor(last.length / 3))) byLast = d + 1;
        }
        const score = Math.min(whole, byLast);
        if (score < bestScore || (score === bestScore && best !== null && href.length < best.length)) {
            bestScore = score;
            best = href;
        }
    }
    const limit = Math.max(2, Math.floor(target.length * 0.35));
    return best !== null && bestScore <= limit ? best : null;
}
