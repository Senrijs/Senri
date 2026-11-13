// Senri と Hono を交互に(Hono → Senri → Hono → …)wrk で測り、「Hono に対して何倍か」を出す
// ほかの VM の負荷で数字がぶれる環境でも比べられるように、絶対値ではなく、すぐ前後に測った Hono との比を使う
// 使い方(bench で。サーバーは RUNTIME のランタイムで立て、測る側はいつも Bun):
//   RUNTIME=bun TARGETS=senri SCENARIOS=static,param,mw bun perf-abab.ts
//   RUNTIME=bun TARGETS=senri@0.2.8,senri@0.2.9,senri@0.2.10,senri@0.3.1 VERSIONS_DIR=~/senri-versions bun perf-abab.ts
// 環境変数(bench/http.ts と同じものは同じ意味):
//   RUNTIME(bun / node / deno)、TARGETS(Hono と比べるもの。既定 senri)、SCENARIOS(既定 static,param,mw)
//   DURATION(1 回の長さ。既定 6s)、WARMUP(既定 3s)、ROUNDS(既定 4)、CONNECTIONS(64)、WRK_THREADS(4)
//   PIN / SERVER_CPUS(0-3)/ WRK_CPUS(4-7)、RAW(1 なら raw も 1 回測って、頭打ちかどうかを見る。既定 1)
// 並びは「Hono, A, Hono, B, Hono, A, …」(ラウンドをまたいで続ける)。A の倍率 = A ÷(すぐ前の Hono とすぐ後の Hono の平均)
// 結果は Markdown の表(倍率の中央値と最小〜最大、req/s の中央値)と、results/perf-<ランタイム>-<日時>.json
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import { join } from "node:path";
import { checkScenario, SCENARIO_REQUESTS, SCENARIOS, type ScenarioName } from "./scenarios.ts";

type Runtime = "bun" | "node" | "deno";
const RUNTIME = (process.env.RUNTIME ?? "bun") as Runtime;
if (!["bun", "node", "deno"].includes(RUNTIME)) throw new Error(`RUNTIME は bun / node / deno のどれか(${RUNTIME})`);
const TARGETS = (process.env.TARGETS ?? "senri").split(",");
const SCENARIO_LIST = (process.env.SCENARIOS?.split(",") ?? SCENARIOS) as ScenarioName[];
const WRK = process.env.WRK ?? "wrk";
const DURATION = process.env.DURATION ?? "6s";
const WARMUP = process.env.WARMUP ?? "3s";
const ROUNDS = Number(process.env.ROUNDS ?? "4");
const CONNECTIONS = process.env.CONNECTIONS ?? "64";
const WRK_THREADS = process.env.WRK_THREADS ?? "4";
const RAW = process.env.RAW !== "0";
const PIN = process.env.PIN !== "0" && platform() === "linux" && spawnSync("taskset", ["--version"]).status === 0;
const SERVER_CPUS = process.env.SERVER_CPUS ?? "0-3";
const WRK_CPUS = process.env.WRK_CPUS ?? "4-7";
const pinned = (list: string, command: string, args: string[]): [string, string[]] => (PIN ? ["taskset", ["-c", list, command, ...args]] : [command, args]);

const wrkVersion = spawnSync(WRK, ["-v"], { encoding: "utf8" });
if (wrkVersion.error || !`${wrkVersion.stdout}${wrkVersion.stderr}`.includes("wrk")) {
    throw new Error(`wrk が見つかりません(${WRK})。インストールするか、環境変数 WRK にパスを入れてください`);
}
const WRK_SCRIPT = join(import.meta.dir, "wrk.lua");

function serverCommand(target: string, scenario: string, port: number): [string, string[]] {
    const args = ["perf-serve.ts", target, scenario, String(port)];
    if (RUNTIME === "node") return ["node", args];
    if (RUNTIME === "deno") return ["deno", ["run", "-A", ...args]];
    return [process.execPath, args];
}

function runtimeVersion(): string {
    if (RUNTIME === "node") return `Node.js ${spawnSync("node", ["--version"], { encoding: "utf8" }).stdout.trim()}`;
    if (RUNTIME === "deno") return spawnSync("deno", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0]!.trim();
    return `Bun ${Bun.version}`;
}

async function startServer(target: string, scenario: string, port: number): Promise<ChildProcess> {
    const [command, args] = pinned(SERVER_CPUS, ...serverCommand(target, scenario, port));
    const child = spawn(command, args, { cwd: import.meta.dir, stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => {
        child.stdout!.on("data", (chunk: Buffer) => chunk.toString().includes("ready") && resolve());
        child.on("exit", (code) => reject(new Error(`${target}(${scenario})のサーバーが終了しました(${code})`)));
    });
    return child;
}

// wrk で負荷をかけて req/s を返す。2xx・3xx 以外の応答や接続のエラーが 1 つでもあればエラー(bench/http.ts と同じ)
function load(url: string, duration: string): number {
    const [command, args] = pinned(WRK_CPUS, WRK, ["-t", WRK_THREADS, "-c", CONNECTIONS, "-d", duration, "-s", WRK_SCRIPT, url]);
    const out = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, WRK_METHOD: "GET" } });
    const line = out.stdout?.split("\n").find((l) => l.startsWith("WRK_JSON "));
    if (out.status !== 0 || !line) throw new Error(`${url}: wrk の結果を読めません(終了コード ${out.status})\n${out.stdout ?? ""}${out.stderr ?? ""}`);
    const r = JSON.parse(line.slice("WRK_JSON ".length));
    if (r.requests === 0 || r.status !== 0 || r.connect + r.read + r.write + r.timeout > 0) {
        throw new Error(`${url}: 期待と違う(リクエスト ${r.requests}、2xx・3xx 以外 ${r.status}、接続のエラー ${r.connect}/${r.read}/${r.write}/${r.timeout})`);
    }
    return r.requests / (r.duration_us / 1e6);
}

const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const header =
    `${runtimeVersion()} / ${cpus()[0]?.model} x ${cpus().length} / wrk -t${WRK_THREADS} -c${CONNECTIONS} -d${DURATION} / ` +
    `${ROUNDS} rounds, Hono-A-Hono-B-...-Hono${PIN ? ` / server on CPU ${SERVER_CPUS}, wrk on CPU ${WRK_CPUS}` : ""}`;
console.log(header);
const started = Date.now();

type Cell = { ratios: number[]; rps: number[]; hono: number[]; raw?: number };
const results: Record<string, Record<string, Cell>> = {};
const children: ChildProcess[] = [];
let port = 3200;
try {
    for (const scenario of SCENARIO_LIST) {
        // シナリオごとにサーバーを立て直す(前のシナリオの JIT の状態を持ち込まない)
        const servers = new Map<string, number>();
        for (const target of ["hono", ...TARGETS, ...(RAW ? ["raw"] : [])]) {
            const p = ++port;
            children.push(await startServer(target, scenario, p));
            servers.set(target, p);
        }
        const path = SCENARIO_REQUESTS[scenario].path;
        const url = (target: string) => `http://127.0.0.1:${servers.get(target)}${path}`;
        for (const target of servers.keys()) {
            if (target === "raw") continue;
            const problem = await checkScenario(await fetch(url(target)), scenario);
            if (problem) throw new Error(`${scenario}(${target}): ${problem}`);
        }
        for (const target of servers.keys()) load(url(target), WARMUP);

        const cells = (results[scenario] = Object.fromEntries(TARGETS.map((t) => [t, { ratios: [], rps: [], hono: [] } as Cell])));
        // 直前の Hono は、ラウンドをまたいで使い回す(Hono, A, Hono, B, Hono, A, …)
        let before = load(url("hono"), DURATION);
        for (let round = 0; round < ROUNDS; round++) {
            // 版の順番もラウンドごとにずらす
            const order = TARGETS.map((_, i) => TARGETS[(i + round) % TARGETS.length]!);
            for (const target of order) {
                const rps = load(url(target), DURATION);
                const after = load(url("hono"), DURATION);
                const base = (before + after) / 2;
                cells[target]!.ratios.push(rps / base);
                cells[target]!.rps.push(rps);
                cells[target]!.hono.push(base);
                console.log(`${scenario.padEnd(7)} ${target.padEnd(14)} ${fmt(rps).padStart(9)} req/s  hono ${fmt(base).padStart(9)}  x${(rps / base).toFixed(3)}`);
                before = after;
            }
        }
        if (RAW) {
            const raw = load(url("raw"), DURATION);
            for (const cell of Object.values(cells)) cell.raw = raw;
            console.log(`${scenario.padEnd(7)} raw            ${fmt(raw).padStart(9)} req/s`);
        }
        for (const child of children.splice(0)) child.kill();
    }

    console.log(`\n${header}\n`);
    console.log("| scenario | target | x Hono (median) | min–max | req/s | Hono req/s | Hono ÷ raw |");
    console.log("|---|---|---:|---:|---:|---:|---:|");
    for (const [scenario, cells] of Object.entries(results)) {
        for (const [target, c] of Object.entries(cells)) {
            const hono = median(c.hono);
            const ceiling = c.raw ? `${(hono / c.raw).toFixed(2)}${hono / c.raw > 0.9 ? " ⚠" : ""}` : "-";
            console.log(
                `| ${scenario} | ${target} | ${median(c.ratios).toFixed(3)} | ${Math.min(...c.ratios).toFixed(3)}–${Math.max(...c.ratios).toFixed(3)} | ${fmt(median(c.rps))} | ${fmt(hono)} | ${ceiling} |`,
            );
        }
    }
    console.log("\n⚠: Hono が raw の 9 割を超えている。頭打ちの可能性があるので、倍率は 1 に寄って見える");
    console.log(`かかった時間: ${((Date.now() - started) / 60000).toFixed(1)} 分`);
    const dir = join(import.meta.dir, "results");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `perf-${RUNTIME}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, `${JSON.stringify({ header, runtime: RUNTIME, targets: TARGETS, duration: DURATION, rounds: ROUNDS, results }, null, 2)}\n`);
    console.log(`${file} に書きました`);
} finally {
    for (const child of children) child.kill();
}
