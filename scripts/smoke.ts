// examples を Bun / Deno / Node で順に起動して、実際に HTTP で叩いて確かめる
// 使い方: node scripts/smoke.ts [bun] [deno] [node]   (省略すると全部)
import { spawn } from "node:child_process";

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

const COMMANDS: Record<string, string[]> = {
    bun: ["bun", "run", "examples/bun/index.ts"],
    deno: ["deno", "run", "--allow-net", "examples/deno/index.ts"],
    node: ["node", "examples/node/index.ts"],
};

type Check = {
    name: string;
    path: string;
    init?: RequestInit;
    status: number;
    body?: string;
};

const CHECKS: Check[] = [
    { name: "テキスト", path: "/hello", status: 200, body: "こんにちは!" },
    { name: "パスパラメーター", path: "/users/42", status: 200, body: "user 42" },
    { name: "POST", path: "/users", init: { method: "POST" }, status: 200 },
    { name: "日本語パラメーター", path: "/users/山田", status: 200, body: "user 山田" },
    { name: "HEAD", path: "/hello", init: { method: "HEAD" }, status: 200, body: "" },
    { name: "OPTIONS", path: "/hello", init: { method: "OPTIONS" }, status: 204 },
    { name: "認証", path: "/admin", status: 401 },
    { name: "認証(//admin)", path: "//admin", status: 401 },
    { name: "認証OK", path: "/admin", init: { headers: { authorization: "secret" } }, status: 200 },
    { name: "400", path: "/users/%E0%A4%A", status: 400 },
    { name: "404", path: "/nope", status: 404 },
    { name: "500", path: "/boom", status: 500 },
];

async function waitForServer(): Promise<void> {
    for (let i = 0; i < 50; i++) {
        try {
            await fetch(`${BASE}/hello`);
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error("サーバーが起動しませんでした");
}

async function smoke(runtime: string): Promise<boolean> {
    const [cmd, ...args] = COMMANDS[runtime]!;
    const child = spawn(cmd!, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));

    let ok = true;
    try {
        await waitForServer();
        for (const check of CHECKS) {
            const res = await fetch(`${BASE}${check.path}`, check.init);
            const body = await res.text();
            const pass = res.status === check.status && (check.body === undefined || body === check.body);
            if (!pass) ok = false;
            console.log(`  ${pass ? "ok  " : "FAIL"} ${check.name}: ${res.status} ${JSON.stringify(body.slice(0, 60))}`);
        }
    } catch (err) {
        ok = false;
        console.log(`  FAIL ${err instanceof Error ? err.message : String(err)}`);
        if (stderr) console.log(stderr);
    } finally {
        child.kill();
        await new Promise((r) => child.once("exit", r));
    }
    return ok;
}

const targets = process.argv.slice(2);
const runtimes = targets.length > 0 ? targets : Object.keys(COMMANDS);

let allOk = true;
for (const runtime of runtimes) {
    if (!COMMANDS[runtime]) throw new Error(`知らないランタイムです: ${runtime}`);
    console.log(`[${runtime}]`);
    if (!(await smoke(runtime))) allOk = false;
}
process.exit(allOk ? 0 : 1);
