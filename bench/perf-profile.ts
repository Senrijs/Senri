// app.fetch をプロセスの中で回し続けて、CPU プロファイル(.cpuprofile)を取る
// Senri のどの関数が時間を使っているかを見るためのもの(割合を見る。速さの数字は perf-abab.ts で取る)
// 使い方(bench で):
//   bun --cpu-prof --cpu-prof-dir=<出力先> perf-profile.ts <target> <scenario>
//   node perf-profile.ts <target> <scenario> <出力先.cpuprofile>
//   deno run -A perf-profile.ts <target> <scenario> <出力先.cpuprofile>
// - Node と Deno は node:inspector の Profiler で取る(Deno には --cpu-prof がないため)。Bun は --cpu-prof で取る
// - target: senri / senri@<版>(VERSIONS_DIR)/ hono / hono-async / hono-init
// - 環境変数: PROFILE_MS(既定 5000)、PROFILE_INTERVAL_US(Node と Deno のサンプリングの間隔。既定 1000)。最初の 1 秒はウォームアップで、プロファイルに入れない(Bun 以外)
// - まとめるときは perf-profile-summary.ts に渡す
import { HONO_VARIANTS, honoScenario, honoVariant, loadSenri, SCENARIO_REQUESTS, senriScenario, checkScenario, type FetchApp, type ScenarioName } from "./scenarios.ts";

const g = globalThis as any;
const args: string[] = g.Deno ? g.Deno.args : g.process.argv.slice(2);
const env = (name: string): string | undefined => (g.Deno ? g.Deno.env.get(name) : g.process.env[name]);
const [target, scenario, out] = args as [string, ScenarioName, string | undefined];
const PROFILE_MS = Number(env("PROFILE_MS") ?? "5000");

let app: FetchApp;
if (target === "hono") app = honoScenario(scenario);
else if ((HONO_VARIANTS as readonly string[]).includes(target)) app = honoVariant(target as (typeof HONO_VARIANTS)[number], scenario);
else if (target === "senri" || target.startsWith("senri@")) {
    const version = target === "senri" ? "src" : target.slice("senri@".length);
    app = senriScenario(await loadSenri(version, env("VERSIONS_DIR")), scenario);
} else throw new Error("使い方: perf-profile.ts <senri|senri@版|hono|hono-async|hono-init> <static|param|mw> [出力先]");

const req = new Request(`http://localhost${SCENARIO_REQUESTS[scenario].path}`);
const problem = await checkScenario(await app.fetch(req), scenario);
if (problem) throw new Error(problem);

async function spin(ms: number): Promise<number> {
    let n = 0;
    const start = performance.now();
    while (performance.now() - start < ms) {
        for (let i = 0; i < 256; i++) {
            const res = await app.fetch(req);
            await res.text();
        }
        n += 256;
    }
    return n;
}

if (g.Bun) {
    // Bun は --cpu-prof が、プロセス全体(ウォームアップも含む)を取る
    const n = await spin(PROFILE_MS + 1000);
    console.log(`${target} ${scenario}: ${n} calls`);
} else {
    if (!out) throw new Error("Node と Deno では、出力先の .cpuprofile を 3 つ目の引数に渡す");
    await spin(1000);
    const { Session } = await import("node:inspector/promises");
    const { writeFileSync } = await import("node:fs");
    const session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: Number(env("PROFILE_INTERVAL_US") ?? "1000") });
    await session.post("Profiler.start");
    const n = await spin(PROFILE_MS);
    const { profile } = (await session.post("Profiler.stop")) as { profile: unknown };
    writeFileSync(out, JSON.stringify(profile));
    session.disconnect();
    console.log(`${target} ${scenario}: ${n} calls → ${out}`);
}
