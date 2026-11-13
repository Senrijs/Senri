// Senri の版どうしを、プロセスの中で app.fetch を直接呼んで比べる(ネットワークなし)
// どの版が遅くなったかを絞るためのもの。本番の数字は wrk(bench/perf-vm.sh)で取る
// 使い方(bench で):
//   VERSIONS_DIR=<古い版を入れたフォルダー> VERSIONS=0.2.9,0.2.10,src bun versions.ts
//   VERSIONS_DIR=... node versions.ts / VERSIONS_DIR=... deno run -A versions.ts
// - 古い版は、リポジトリの外のフォルダーに npm から別名で入れる(bench/README.md の「版ごとに比べる」)
// - 環境変数: VERSIONS(既定 src)、SCENARIOS(既定 static,param,mw)、ROUNDS(既定 7)、TIME_MS(1 回の長さ。既定 400)、HONO=1 で Hono も並べる
// - 版の順番をラウンドごとにずらして交互に測り、1 回の処理の時間(ns)の中央値と、最小〜最大を出す
import { checkScenario, honoScenario, loadSenri, SCENARIO_REQUESTS, SCENARIOS, senriScenario, type FetchApp, type ScenarioName } from "./scenarios.ts";

const env = (name: string): string | undefined => (globalThis as any).Deno?.env.get(name) ?? (globalThis as any).process?.env[name];

const VERSIONS = (env("VERSIONS") ?? "src").split(",");
const VERSIONS_DIR = env("VERSIONS_DIR");
const SCENARIO_LIST = (env("SCENARIOS")?.split(",") ?? SCENARIOS) as ScenarioName[];
const ROUNDS = Number(env("ROUNDS") ?? "7");
const TIME_MS = Number(env("TIME_MS") ?? "400");
const WITH_HONO = env("HONO") === "1";

function runtimeName(): string {
    const g = globalThis as any;
    if (g.Bun) return `Bun ${g.Bun.version}`;
    if (g.Deno) return `Deno ${g.Deno.version.deno}`;
    return `Node.js ${g.process.version}`;
}

// TIME_MS のあいだ呼び続けて、1 回あたりの ns を返す
async function measure(app: FetchApp, req: Request, ms: number): Promise<number> {
    let n = 0;
    const start = performance.now();
    let now = start;
    while (now - start < ms) {
        // 時計を読む回数を減らすため、まとめて呼ぶ
        for (let i = 0; i < 256; i++) {
            const res = await app.fetch(req);
            await res.text();
        }
        n += 256;
        now = performance.now();
    }
    return ((now - start) * 1e6) / n;
}

const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const mods = new Map<string, Awaited<ReturnType<typeof loadSenri>>>();
for (const v of VERSIONS) mods.set(v, await loadSenri(v, VERSIONS_DIR));

const header = `${runtimeName()} / in-process app.fetch / ${ROUNDS} rounds x ${TIME_MS} ms (median, ns/op)`;
console.log(header);
const table: Record<string, Record<string, number[]>> = {};
const names = [...VERSIONS, ...(WITH_HONO ? ["hono"] : [])];

for (const scenario of SCENARIO_LIST) {
    const apps = new Map<string, FetchApp>();
    for (const v of VERSIONS) apps.set(v, senriScenario(mods.get(v)!, scenario, v));
    if (WITH_HONO) apps.set("hono", honoScenario(scenario));
    const req = new Request(`http://localhost${SCENARIO_REQUESTS[scenario].path}`);
    for (const [name, app] of apps) {
        const problem = await checkScenario(await app.fetch(req), scenario);
        if (problem) throw new Error(`${scenario}(${name}): ${problem}`);
        await measure(app, req, TIME_MS); // ウォームアップ
    }
    for (let round = 0; round < ROUNDS; round++) {
        for (let i = 0; i < names.length; i++) {
            const name = names[(i + round) % names.length]!;
            ((table[scenario] ??= {})[name] ??= []).push(await measure(apps.get(name)!, req, TIME_MS));
        }
    }
}

console.log(`\n${header}\n`);
console.log("| version | " + SCENARIO_LIST.join(" | ") + " |");
console.log("|---|" + SCENARIO_LIST.map(() => "---:").join("|") + "|");
for (const name of names) {
    const cells = SCENARIO_LIST.map((s) => {
        const xs = table[s]![name]!;
        return `${median(xs).toFixed(0)} (${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)})`;
    });
    console.log(`| ${name} | ${cells.join(" | ")} |`);
}
