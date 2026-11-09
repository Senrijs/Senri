// HTTP 越しに比べるベンチマーク。サーバーを別のプロセスで立てて、wrk で負荷をかける
// 使い方: cd bench && bun install && bun run http          … Bun
//         RUNTIME=node bun run http / RUNTIME=deno bun run http   … Node.js / Deno(測る側はいつも Bun で動かす)
// - wrk(https://github.com/wg/wrk)が必要。PATH にないときは環境変数 WRK に実行ファイルのパスを入れる
// - wrk は JSON を出さないので、wrk.lua の done() が結果を「WRK_JSON {...}」の 1 行で出し、それを読む
// - DURATION(既定 10s)・CONNECTIONS(既定 64)・WRK_THREADS(既定 4)・ROUNDS(既定 3)・FRAMEWORKS(既定はランタイムごと)で条件を変えられる
// - Linux で taskset があれば、サーバーを SERVER_CPUS(既定 0-3)、wrk を WRK_CPUS(既定 4-7)のコアに固定する
//   (同じマシンで負荷をかける側とサーバーが取り合わないように)。PIN=0 で固定しない
// - 結果は表を出し、生の値を results/<ランタイム>-<日時>.json に書く
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import { join } from "node:path";
import { checkResponse, REQUESTS } from "./apps.ts";

type Runtime = "bun" | "node" | "deno";
const RUNTIME = (process.env.RUNTIME ?? "bun") as Runtime;
const WRK = process.env.WRK ?? "wrk";
const DURATION = process.env.DURATION ?? "10s";
const CONNECTIONS = process.env.CONNECTIONS ?? "64";
const WRK_THREADS = process.env.WRK_THREADS ?? "4";
const ROUNDS = Number(process.env.ROUNDS ?? "3");
const DEFAULT_FRAMEWORKS: Record<Runtime, string[]> = {
    bun: ["senri", "hono", "elysia", "raw"],
    // senri-0.2.9: Node の近道(#44・#46・#47)より前。「Node.js で約 4 倍」を確かめ直すため
    node: ["senri", "senri-0.2.9", "hono", "elysia", "raw"],
    deno: ["senri", "hono", "elysia", "raw"],
};
if (!(RUNTIME in DEFAULT_FRAMEWORKS)) throw new Error(`RUNTIME は bun / node / deno のどれか(${RUNTIME})`);
const FRAMEWORKS = process.env.FRAMEWORKS?.split(",") ?? DEFAULT_FRAMEWORKS[RUNTIME];
// 全部のリクエストを測ると長いので、種類の違うものだけ
const TARGETS = REQUESTS.filter(([name]) => ["static (short)", "1 param", "3 params", "not found"].includes(name));

// Linux で taskset があれば、コアを固定する
const PIN = process.env.PIN !== "0" && platform() === "linux" && spawnSync("taskset", ["--version"]).status === 0;
const SERVER_CPUS = process.env.SERVER_CPUS ?? "0-3";
const WRK_CPUS = process.env.WRK_CPUS ?? "4-7";
const pinned = (cpusList: string, command: string, args: string[]): [string, string[]] => (PIN ? ["taskset", ["-c", cpusList, command, ...args]] : [command, args]);

// wrk -v は版を出して 0 以外で終わることがあるので、終了コードではなく出力で確かめる
const wrkVersion = spawnSync(WRK, ["-v"], { encoding: "utf8" });
if (wrkVersion.error || !`${wrkVersion.stdout}${wrkVersion.stderr}`.includes("wrk")) {
    throw new Error(`wrk が見つかりません(${WRK})。インストールするか、環境変数 WRK にパスを入れてください`);
}
const WRK_SCRIPT = join(import.meta.dir, "wrk.lua");

// ランタイムごとのサーバーの立て方
function serverCommand(name: string, port: number): [string, string[]] {
    if (RUNTIME === "node") return ["node", ["server-node.ts", name, String(port)]];
    if (RUNTIME === "deno") return ["deno", ["run", "-A", "server-deno.ts", name, String(port)]];
    return [process.execPath, ["server.ts", name, String(port)]];
}

function runtimeVersion(): string {
    if (RUNTIME === "node") return `Node.js ${spawnSync("node", ["--version"], { encoding: "utf8" }).stdout.trim()}`;
    if (RUNTIME === "deno") return spawnSync("deno", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0]!.trim();
    return `Bun ${Bun.version}`;
}

async function startServer(name: string, port: number) {
    const [command, args] = pinned(SERVER_CPUS, ...serverCommand(name, port));
    const child = spawn(command, args, { cwd: import.meta.dir, stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => chunk.toString().includes("ready") && resolve());
        child.on("exit", (code) => reject(new Error(`${name} のサーバーが終了しました(${code})`)));
    });
    return child;
}

// wrk.lua の done() が出す 1 行
type WrkResult = {
    requests: number;
    duration_us: number;
    bytes: number;
    connect: number;
    read: number;
    write: number;
    status: number; // 2xx と 3xx 以外の応答の数
    timeout: number;
    latency_p50_us: number;
    latency_p99_us: number;
};

// 負荷をかけて req/s を返す。期待と違う応答や接続のエラーが1つでもあったら、その数字は使わずにエラーにする
// (404 や 500 の速さを測ってしまわないように)
// wrk は status ごとの数を出さないので、「2xx・3xx 以外の数」で確かめる。200 を期待するときは 0、404 を期待するときは全部
// (404 のときは 404 以外の 4xx・5xx と見分けられないが、測る前に fetch で status と本文を確かめている)
function load(method: string, url: string, duration: string, route: string | null): number {
    const [command, args] = pinned(WRK_CPUS, WRK, ["-t", WRK_THREADS, "-c", CONNECTIONS, "-d", duration, "-s", WRK_SCRIPT, url]);
    const out = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, WRK_METHOD: method } });
    const line = out.stdout?.split("\n").find((l) => l.startsWith("WRK_JSON "));
    if (out.status !== 0 || !line) {
        throw new Error(`${method} ${url}: wrk の結果を読めません(終了コード ${out.status})\n${out.stdout ?? ""}${out.stderr ?? ""}`);
    }
    const result = JSON.parse(line.slice("WRK_JSON ".length)) as WrkResult;
    const expectedBad = route === null ? result.requests : 0;
    const socketErrors = result.connect + result.read + result.write + result.timeout;
    if (result.requests === 0 || result.status !== expectedBad || socketErrors > 0) {
        throw new Error(
            `${method} ${url}: 期待と違う(${route === null ? 404 : 200} を期待。リクエスト ${result.requests}、2xx・3xx 以外 ${result.status}、` +
                `接続のエラー connect ${result.connect} / read ${result.read} / write ${result.write} / timeout ${result.timeout})`,
        );
    }
    return result.requests / (result.duration_us / 1e6);
}

// 偶数個なら、真ん中の2つの平均
function median(xs: number[]): number {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const header = `${runtimeVersion()} / ${cpus()[0]?.model} x ${cpus().length} / wrk -t${WRK_THREADS} -c${CONNECTIONS} -d${DURATION} / ${ROUNDS} rounds (median)${PIN ? ` / server on CPU ${SERVER_CPUS}, wrk on CPU ${WRK_CPUS}` : ""}`;
console.log(header);
// サーバーは全部先に立てておき、同じリクエストをフレームワークの順番を変えながら交互に測る
// (マシンの負荷が途中で変わっても、特定のフレームワークだけが損をしないように)
const servers = new Map<string, { port: number; kill(): void }>();
let port = 3100;
try {
    for (const name of FRAMEWORKS) {
        const p = ++port;
        const child = await startServer(name, p);
        servers.set(name, { port: p, kill: () => child.kill() });
    }
    const rows: Record<string, Record<string, number[]>> = {};
    for (const [label, method, path, route] of TARGETS) {
        // 中身が正しいか(status だけでなく本文も)を先に確かめる
        for (const [name, { port }] of servers) {
            const problem = await checkResponse(await fetch(`http://127.0.0.1:${port}${path}`, { method }), route);
            if (problem) throw new Error(`${label}(${name}): ${problem}`);
        }
        // ウォームアップ(JIT が落ち着くまで)
        for (const [, { port }] of servers) load(method, `http://127.0.0.1:${port}${path}`, "2s", route);
        for (let round = 0; round < ROUNDS; round++) {
            const order = FRAMEWORKS.map((_, i) => FRAMEWORKS[(i + round) % FRAMEWORKS.length]!);
            for (const name of order) {
                const rps = load(method, `http://127.0.0.1:${servers.get(name)!.port}${path}`, DURATION, route);
                ((rows[label] ??= {})[name] ??= []).push(rps);
                console.log(`${label.padEnd(16)} ${name.padEnd(12)} ${Math.round(rps).toLocaleString("en-US").padStart(9)} req/s`);
            }
        }
    }

    console.log(`\n${header}\n`);
    console.log("| | " + FRAMEWORKS.join(" | ") + " |");
    console.log("|---|" + FRAMEWORKS.map(() => "---:").join("|") + "|");
    for (const [label, byName] of Object.entries(rows)) {
        console.log(`| ${label} | ` + FRAMEWORKS.map((n) => Math.round(median(byName[n]!)).toLocaleString("en-US")).join(" | ") + " |");
    }
    // 生の値を残す(あとで比べたり、表を作り直したりできるように)
    const dir = join(import.meta.dir, "results");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${RUNTIME}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, `${JSON.stringify({ header, runtime: RUNTIME, duration: DURATION, connections: CONNECTIONS, threads: WRK_THREADS, rounds: ROUNDS, rows }, null, 2)}\n`);
    console.log(`\n${file} に書きました`);
} finally {
    for (const [, server] of servers) server.kill();
}
