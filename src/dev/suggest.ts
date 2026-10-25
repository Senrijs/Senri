// dp[i][j] = a の先頭 i 文字と b の先頭 j 文字が、何回の「追加・削除・置き換え」で同じになるか
function table(a: string, b: string): number[][] {
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
    return dp;
}

// 2つの文字列が、何回の「追加・削除・置き換え」で同じになるかを数える
export function distance(a: string, b: string): number {
    return table(a, b)[a.length]![b.length]!;
}

export type Difference = {
    // 候補(正しいほう)のパスを、印を付けたい文字とそれ以外に分けたもの
    parts: { text: string; mark: boolean }[];
    // 「"l" が1文字足りません」のような説明
    note: string;
};

type Op =
    | { kind: "same"; ch: string }
    | { kind: "missing"; ch: string } // 候補にあって、リクエストにない
    | { kind: "extra"; ch: string } // リクエストにあって、候補にない
    | { kind: "changed"; ch: string; was: string };

// リクエストされたパスと候補のパスの、どこが違うかを調べる
// DP の表を右下(両方の最後)から左上へたどると、1文字ずつ「同じ / 足りない / 多い / 違う」が分かる
export function explainDifference(requested: string, suggested: string): Difference {
    const dp = table(requested, suggested);
    const ops: Op[] = [];
    let i = requested.length;
    let j = suggested.length;
    while (i > 0 || j > 0) {
        const here = dp[i]![j]!;
        // 「足りない」を先に試すと、"/helo" → "/hello" で後ろの l に印が付く("/hel" + "l" + "o")
        if (j > 0 && here === dp[i]![j - 1]! + 1) {
            ops.push({ kind: "missing", ch: suggested[j - 1]! });
            j--;
        } else if (i > 0 && j > 0 && requested[i - 1] === suggested[j - 1] && here === dp[i - 1]![j - 1]!) {
            ops.push({ kind: "same", ch: suggested[j - 1]! });
            i--;
            j--;
        } else if (i > 0 && j > 0 && here === dp[i - 1]![j - 1]! + 1) {
            ops.push({ kind: "changed", ch: suggested[j - 1]!, was: requested[i - 1]! });
            i--;
            j--;
        } else {
            ops.push({ kind: "extra", ch: requested[i - 1]! });
            i--;
        }
    }
    ops.reverse();

    // 候補のパスを、印あり・なしのかたまりに分ける(「多い」文字は候補にないので出てこない)
    const parts: Difference["parts"] = [];
    for (const op of ops) {
        if (op.kind === "extra") continue;
        const mark = op.kind !== "same";
        const last = parts.at(-1);
        if (last && last.mark === mark) last.text += op.ch;
        else parts.push({ text: op.ch, mark });
    }

    const diffs = ops.filter((op) => op.kind !== "same");
    const chars = diffs.map((op) => op.ch).join("");
    let note: string;
    if (diffs.every((op) => op.kind === "missing")) {
        note = `"${chars}" が${diffs.length}文字足りません`;
    } else if (diffs.every((op) => op.kind === "extra")) {
        note = `"${chars}" が${diffs.length}文字多いです`;
    } else if (diffs.length === 1 && diffs[0]!.kind === "changed") {
        note = `"${diffs[0]!.ch}" のところが "${diffs[0]!.was}" になっています`;
    } else {
        note = `${diffs.length}か所違います`;
    }
    return { parts, note };
}

const MAX_DISTANCE = 3;
// これより長いパスはタイプミスではないと見なして計算しない(長いほど計算が重くなるので)
const MAX_PATH_LENGTH = 200;

// いちばん近いルートを探す(距離が3より大きければ null)
export function suggest<R extends { path: string }>(routes: R[], path: string): R | null {
    if (path.length > MAX_PATH_LENGTH) return null;

    let closest: R | null = null;
    let best = Infinity;
    for (const r of routes) {
        // 長さの差がそのまま距離の下限になるので、差が大きければ計算するまでもない
        if (Math.abs(r.path.length - path.length) > MAX_DISTANCE) continue;
        const d = distance(r.path, path);
        if (d < best) {
            closest = r;
            best = d;
        }
    }
    return closest && best <= MAX_DISTANCE ? closest : null;
}
