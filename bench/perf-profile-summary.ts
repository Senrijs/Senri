// .cpuprofile(perf-profile.ts で取ったもの)をまとめる
// 使い方: bun perf-profile-summary.ts <file.cpuprofile> [上位の数(既定 25)]
// 出すもの:
// - 分類ごとの割合(Senri / Hono / bench / ランタイム本体と GC など)
// - 関数ごとの self(その関数そのもの)と total(呼んだ先も含む)の割合。Senri の関数は別にも出す
// 割合は、プロファイル全体の時間((idle) を除く)に対するもの
import { readFileSync } from "node:fs";

type CallFrame = { functionName: string; url: string; lineNumber: number };
type ProfileNode = { id: number; callFrame: CallFrame; children?: number[]; hitCount?: number };
type Profile = { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[]; startTime: number; endTime: number };

const [file, topText] = process.argv.slice(2);
if (!file) throw new Error("使い方: bun perf-profile-summary.ts <file.cpuprofile> [上位の数]");
const TOP = Number(topText ?? "25");
const profile = JSON.parse(readFileSync(file, "utf8")) as Profile;

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);

function category(cf: CallFrame): string {
    const url = cf.url.replaceAll("\\", "/");
    if (/\/senri-[\d.]+\/dist\/|\/src\/[^/]+\.(ts|js)$|\/src\/middleware\/|\/adapters\/node\//.test(url) && !url.includes("node_modules/hono")) return "senri";
    if (url.includes("/hono/") || url.includes("@hono/")) return "hono";
    if (url.includes("/bench/")) return "bench";
    if (cf.functionName === "(garbage collector)") return "gc";
    if (cf.functionName === "(program)" || cf.functionName === "(idle)") return cf.functionName;
    return "runtime";
}

function keyOf(cf: CallFrame): string {
    const url = cf.url.replaceAll("\\", "/");
    const short = url.replace(/^.*\/(senri-[\d.]+\/dist\/|src\/|adapters\/|bench\/|hono\/dist\/)/, "$1");
    return `${cf.functionName || "(anonymous)"}${short ? ` ${short}:${cf.lineNumber + 1}` : ""}`;
}

// サンプルごとの時間。timeDeltas がなければ、hitCount と平均の間隔で代わりにする
const self = new Map<number, number>();
if (profile.samples && profile.timeDeltas) {
    // timeDeltas[i] は i 番目のサンプルの直前からの時間。次のサンプルまでの時間を、そのサンプルに付ける
    for (let i = 0; i < profile.samples.length; i++) {
        const dt = profile.timeDeltas[i + 1] ?? 0;
        self.set(profile.samples[i]!, (self.get(profile.samples[i]!) ?? 0) + Math.max(dt, 0));
    }
} else {
    const hits = profile.nodes.reduce((s, n) => s + (n.hitCount ?? 0), 0);
    const per = (profile.endTime - profile.startTime) / Math.max(hits, 1);
    for (const n of profile.nodes) if (n.hitCount) self.set(n.id, n.hitCount * per);
}

let total = 0;
const selfByKey = new Map<string, { t: number; cat: string }>();
const totalByKey = new Map<string, number>();
const byCat = new Map<string, number>();
for (const [id, t] of self) {
    const node = byId.get(id)!;
    if (node.callFrame.functionName === "(idle)") continue;
    total += t;
    const cat = category(node.callFrame);
    byCat.set(cat, (byCat.get(cat) ?? 0) + t);
    const k = keyOf(node.callFrame);
    const s = selfByKey.get(k) ?? { t: 0, cat };
    s.t += t;
    selfByKey.set(k, s);
    // total: 祖先の関数にも足す(再帰で同じ関数が何度も出ても 1 回だけ)
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
        const key = keyOf(byId.get(cur)!.callFrame);
        if (seen.has(key)) continue;
        seen.add(key);
        totalByKey.set(key, (totalByKey.get(key) ?? 0) + t);
    }
}

const pct = (t: number) => `${((t / total) * 100).toFixed(1)}%`;
console.log(`# ${file}\n\n全体 ${(total / 1000).toFixed(0)} ms((idle) を除く)\n`);
console.log("| 分類 | 割合 |\n|---|---:|");
for (const [cat, t] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`| ${cat} | ${pct(t)} |`);

const table = (title: string, rows: [string, { t: number; cat: string }][]) => {
    console.log(`\n## ${title}\n\n| 関数 | 分類 | self | total |\n|---|---|---:|---:|`);
    for (const [k, v] of rows.slice(0, TOP)) console.log(`| \`${k}\` | ${v.cat} | ${pct(v.t)} | ${pct(totalByKey.get(k) ?? 0)} |`);
};
const sorted = [...selfByKey].sort((a, b) => b[1].t - a[1].t);
table("self の上位(全部)", sorted);
table("self の上位(Senri の関数だけ)", sorted.filter(([, v]) => v.cat === "senri"));
// total で見た Senri の関数(どの処理の下で時間を使っているか)
console.log(`\n## total の上位(Senri の関数だけ)\n\n| 関数 | total |\n|---|---:|`);
for (const [k, t] of [...totalByKey].filter(([k]) => selfByKey.get(k)?.cat === "senri" || /src\/|senri-/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`| \`${k}\` | ${pct(t)} |`);
}
