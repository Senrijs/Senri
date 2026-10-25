// 2つの文字列が、何回の「追加・削除・置き換え」で同じになるかを数える
export function distance(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i]![j] = Math.min(
                dp[i - 1]![j]! + 1,
                dp[i]![j - 1]! + 1,
                dp[i - 1]![j - 1]! + cost,
            );
        }
    }
    return dp[a.length]![b.length]!;
}

// いちばん近いルートを探す(距離が3より大きければ null)
export function suggest<R extends { path: string }>(routes: R[], path: string): R | null {
    let closest: R | null = null;
    let best = Infinity;
    for (const r of routes) {
        const d = distance(r.path, path);
        if (d < best) {
            closest = r;
            best = d;
        }
    }
    return closest && best <= 3 ? closest : null;
}
