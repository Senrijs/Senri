// ルートが多いアプリの型チェックの時間を、Senri の版どうしで比べる(#160・#161)
//
//   bun bench/types/run.ts [--routes 200,2000] [--runs 11] <書き方>@<ref> ...
//
//   例: bun bench/types/run.ts plain@origin/main chain@.
//
// - <書き方> は gen.ts の plain / chain / scoped
// - <ref> は git の ref(origin/main など)か、. (いまの作業中のフォルダーの src)。ref の src は bench/types/out/ に写す
// - 渡した組み合わせを交互に tsc --extendedDiagnostics --singleThreaded で型チェックして、
//   Check time の最小と中央値、型のインスタンス化の数(何回でも同じ)、型エラーの数を出す
// - 時間は、ほかの作業で機械が混んでいるとばらつく。インスタンス化の数のほうが比べやすい
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generate, VARIANTS, type Variant } from "./gen.ts";

const ROOT = join(import.meta.dirname, "../..");
const OUT = join(import.meta.dirname, "out");
const TSC = ["tsc.exe", "tsc"].map((name) => join(ROOT, "node_modules/.bin", name)).find((p) => existsSync(p));

let routes = [200, 2000];
let runs = 11;
const cases: { variant: Variant; ref: string }[] = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--routes") routes = args[++i]!.split(",").map(Number);
    else if (arg === "--runs") runs = Number(args[++i]);
    else {
        const [variant, ref = "."] = arg.split("@") as [Variant, string?];
        if (!VARIANTS.includes(variant)) throw new Error(`unknown variant: ${variant} (${VARIANTS.join(", ")})`);
        cases.push({ variant, ref });
    }
}
if (cases.length === 0 || !TSC || routes.some((n) => !(n > 0)) || !(runs > 0)) {
    console.error("usage: bun bench/types/run.ts [--routes 200,2000] [--runs 11] <plain|chain|scoped>@<ref|.> ...");
    process.exit(1);
}

// ref の src を out/src-<ref>/src に写す。. はいまの src をそのまま使う
function srcOf(ref: string): string {
    if (ref === ".") return "../../../../src/index.ts";
    const name = `src-${ref.replace(/[^\w.-]/g, "_")}`;
    const dir = join(OUT, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // tar を使わない(Windows の Git Bash の tar は、C:\ のコロンを相手のホスト名と読む)
    const git = (...a: string[]) => {
        const r = Bun.spawnSync(["git", ...a], { cwd: ROOT });
        if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString()}`);
        return r.stdout;
    };
    for (const file of git("ls-tree", "-r", "--name-only", ref, "src").toString().split("\n").filter(Boolean)) {
        const target = join(dir, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, git("show", `${ref}:${file}`));
    }
    return `../${name}/src/index.ts`;
}

type Row = { label: string; dir: string; times: number[]; instantiations: number; errors: number };
const rows: Row[] = [];
const srcs = new Map<string, string>();
for (const n of routes) {
    for (const { variant, ref } of cases) {
        if (!srcs.has(ref)) srcs.set(ref, srcOf(ref));
        const label = `${variant}@${ref} ${n} routes`;
        const dir = join(OUT, `${variant}-${ref.replace(/[^\w.-]/g, "_")}-${n}`);
        generate(dir, variant, n, srcs.get(ref)!);
        rows.push({ label, dir, times: [], instantiations: 0, errors: 0 });
    }
}

const number = (text: string, name: string) => Number(new RegExp(`^${name}:\\s+([\\d.]+)`, "m").exec(text)?.[1] ?? NaN);
for (let i = 0; i < runs; i++) {
    for (const row of rows) {
        const result = Bun.spawnSync([TSC, "-p", row.dir, "--extendedDiagnostics", "--singleThreaded"], { cwd: ROOT });
        const text = result.stdout.toString() + result.stderr.toString();
        row.times.push(number(text, "Check time"));
        row.instantiations = number(text, "Instantiations");
        row.errors = text.match(/error TS\d+/g)?.length ?? 0;
    }
    process.stderr.write(`run ${i + 1}/${runs}\r`);
}
process.stderr.write("\n");

console.log("| 組み合わせ | Check time の最小 | 中央値 | インスタンス化 | 型エラー |");
console.log("|---|---:|---:|---:|---:|");
for (const row of rows) {
    const sorted = [...row.times].sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
    console.log(`| ${row.label} | ${sorted[0]!.toFixed(3)}s | ${median.toFixed(3)}s | ${row.instantiations.toLocaleString("en")} | ${row.errors} |`);
}
