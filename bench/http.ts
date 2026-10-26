// HTTP 越しに比べるベンチマーク。サーバーを別のプロセスで立てて、oha で負荷をかける
// 使い方: cd bench && bun install && bun run http
// - oha(https://github.com/hatoo/oha)が必要。PATH にないときは環境変数 OHA に実行ファイルのパスを入れる
// - DURATION(既定 10s)・CONNECTIONS(既定 64)・ROUNDS(既定 3)・FRAMEWORKS(既定 senri,hono,elysia)で条件を変えられる
import { spawn, spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { checkResponse, REQUESTS } from "./apps.ts";

const OHA = process.env.OHA ?? "oha";
const DURATION = process.env.DURATION ?? "10s";
const CONNECTIONS = process.env.CONNECTIONS ?? "64";
const ROUNDS = Number(process.env.ROUNDS ?? "3");
const FRAMEWORKS = process.env.FRAMEWORKS?.split(",") ?? ["senri", "hono", "elysia"];
// 全部のリクエストを測ると長いので、種類の違うものだけ
const TARGETS = REQUESTS.filter(([name]) => ["static (short)", "1 param", "3 params", "not found"].includes(name));

if (spawnSync(OHA, ["--version"]).status !== 0) {
    throw new Error(`oha が見つかりません(${OHA})。インストールするか、環境変数 OHA にパスを入れてください`);
}

async function startServer(name: string, port: number) {
    const child = spawn(process.execPath, ["server.ts", name, String(port)], { cwd: import.meta.dir, stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => chunk.toString().includes("ready") && resolve());
        child.on("exit", (code) => reject(new Error(`${name} のサーバーが終了しました(${code})`)));
    });
    return child;
}

// 負荷をかけて req/s を返す。期待と違う status が1つでも返っていたら、その数字は使わずにエラーにする
// (404 や 500 の速さを測ってしまわないように)
function load(method: string, url: string, duration: string, route: string | null): number {
    const out = spawnSync(OHA, ["-z", duration, "-c", CONNECTIONS, "-m", method, "--no-tui", "--output-format", "json", url], {
        encoding: "utf8",
    });
    const result = JSON.parse(out.stdout);
    const expected = String(route === null ? 404 : 200);
    const statuses = Object.keys(result.statusCodeDistribution ?? {});
    if (statuses.length === 0 || statuses.some((s) => s !== expected)) {
        throw new Error(`${method} ${url}: status が ${expected} 以外を含む(${statuses.join(", ") || "応答なし"})`);
    }
    return result.summary.requestsPerSec;
}

// 偶数個なら、真ん中の2つの平均
function median(xs: number[]): number {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

console.log(`Bun ${Bun.version} / ${cpus()[0]?.model} x ${cpus().length} / oha -z ${DURATION} -c ${CONNECTIONS} / ${ROUNDS} rounds (median)`);
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
                console.log(`${label.padEnd(16)} ${name.padEnd(7)} ${Math.round(rps).toLocaleString("en-US").padStart(9)} req/s`);
            }
        }
    }

    console.log("\n| | " + FRAMEWORKS.join(" | ") + " |");
    console.log("|---|" + FRAMEWORKS.map(() => "---:").join("|") + "|");
    for (const [label, byName] of Object.entries(rows)) {
        console.log(`| ${label} | ` + FRAMEWORKS.map((n) => Math.round(median(byName[n]!)).toLocaleString("en-US")).join(" | ") + " |");
    }
} finally {
    for (const [, server] of servers) server.kill();
}
