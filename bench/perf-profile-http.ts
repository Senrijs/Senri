// サーバー(perf-serve.ts)を立てて要求を送り続け、そのあいだのサーバーの CPU プロファイルを取る
// Bun.serve / Deno.serve / Node のアダプターを通したときに、どこで時間を使っているかを見るためのもの
// 使い方(bench で。この スクリプトは Bun で動かす):
//   bun perf-profile-http.ts <bun|node|deno> <target> <scenario> <出力先のフォルダー>
//   → <出力先>/<ランタイム>-<target>-<scenario>.cpuprofile。まとめるときは perf-profile-summary.ts に渡す
// - 送る側は、プロファイルを取るために流すだけのもの(Bun の fetch を CONCURRENCY 本、既定 32)。req/s の数字は使わない
//   (速さは wrk で測る。perf-abab.ts)
// - 環境変数: PROFILE_MS(既定 5000)、CONCURRENCY(既定 32)、PROFILE_INTERVAL_US(サンプリングの間隔。既定 1000)
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { SCENARIO_REQUESTS, type ScenarioName } from "./scenarios.ts";

const [runtime, target, scenario, outDirArg] = process.argv.slice(2) as [string, string, ScenarioName, string];
if (!runtime || !target || !scenario || !outDirArg) throw new Error("使い方: bun perf-profile-http.ts <bun|node|deno> <target> <scenario> <出力先>");
const outDir = resolve(outDirArg);
const PROFILE_MS = process.env.PROFILE_MS ?? "5000";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "32");
const port = 3900 + Math.floor(Math.random() * 90);
const name = `${runtime}-${target.replace("@", "-")}-${scenario}.cpuprofile`;
const out = join(outDir, name);

const serveArgs = ["perf-serve.ts", target, scenario, String(port)];
const [command, args]: [string, string[]] =
    runtime === "bun"
        ? [process.execPath, [`--cpu-prof`, `--cpu-prof-dir=${outDir}`, `--cpu-prof-name=${name}`, `--cpu-prof-interval=${process.env.PROFILE_INTERVAL_US ?? "1000"}`, ...serveArgs]]
        : runtime === "node"
          ? ["node", ["--cpu-prof", `--cpu-prof-dir=${outDir}`, `--cpu-prof-name=${name}`, `--cpu-prof-interval=${process.env.PROFILE_INTERVAL_US ?? "1000"}`, ...serveArgs]]
          : ["deno", ["run", "-A", ...serveArgs]];
const child = spawn(command, args, {
    cwd: import.meta.dir,
    stdio: ["ignore", "pipe", "inherit"],
    // PROFILE_OUT は Deno だけ(Deno には --cpu-prof がない)。Node と Bun は --cpu-prof で取り、起動の分も入る
    // サンプリングの間隔は既定 1000 µs。Windows で 100 µs にすると、サーバーが数十分の 1 しか答えなくなった
    env: { ...process.env, PROFILE_MS, ...(runtime === "deno" ? { PROFILE_OUT: out } : {}) },
});
let finished = false;
const exited = new Promise<void>((done) => child.on("exit", () => ((finished = true), done())));
await new Promise<void>((ready) => child.stdout.on("data", (b: Buffer) => b.toString().includes("ready") && ready()));

const url = `http://127.0.0.1:${port}${SCENARIO_REQUESTS[scenario].path}`;
let sent = 0;
let failed = 0;
let firstError: unknown;
const worker = async () => {
    while (!finished) {
        try {
            const res = await fetch(url);
            await res.arrayBuffer();
            sent++;
        } catch (err) {
            // サーバーが終わったところなら、ここで止まる。それ以外は数えて続ける
            failed++;
            firstError ??= err;
        }
    }
};
await Promise.all([...Array.from({ length: CONCURRENCY }, worker), exited]);
console.log(`${name}: ${sent} requests, ${failed} errors → ${out}`);
if (failed > CONCURRENCY) console.log(`  最初のエラー: ${firstError}`);
