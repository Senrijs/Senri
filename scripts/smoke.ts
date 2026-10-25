// examples を Bun / Deno / Node で順に起動して、実際に HTTP で叩いて確かめる
// 使い方: node scripts/smoke.ts [bun] [deno] [node]   (省略すると全部)
import { spawn } from "node:child_process";
import net from "node:net";

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
    cookies?: string[];
};

const CHECKS: Check[] = [
    { name: "テキスト", path: "/hello", status: 200, body: "こんにちは!" },
    { name: "パスパラメーター", path: "/users/42", status: 200, body: "user 42" },
    { name: "POST", path: "/users", init: { method: "POST" }, status: 200 },
    { name: "POST のボディ", path: "/echo", init: { method: "POST", body: "こんにちは" }, status: 200, body: "body=こんにちは" },
    { name: "Set-Cookie 2つ", path: "/cookies", status: 200, cookies: ["a=1", "b=2"] },
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

// fetch では送れない、生の HTTP リクエストで確かめるもの
type RawCheck = { name: string; request: string; status: number };

const RAW_CHECKS: RawCheck[] = [
    // Host をつないで URL を作ると http://x/admin#/hello になり、パスが /admin に化ける
    {
        name: "不正な Host(パスのすり替え)",
        request: "GET /hello HTTP/1.1\r\nHost: x/admin#\r\nConnection: close\r\n\r\n",
        status: 400,
    },
];

function sendRaw(request: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const sock = net.connect(PORT, "localhost", () => sock.write(request));
        let data = "";
        sock.on("data", (d) => (data += d));
        sock.on("end", () => resolve(Number(data.split(" ")[1])));
        sock.on("error", reject);
    });
}

async function waitForServer(exited: () => boolean): Promise<void> {
    for (let i = 0; i < 50; i++) {
        // 起動しないまま終わったなら、待っても無駄なのですぐに失敗にする
        if (exited()) throw new Error("サーバーが起動前に終了しました");
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
    let exited = false;
    // 終了の待ち合わせは spawn の直後に用意する
    // あとで once("exit") を付けると、先に終わっていた(起動直後に落ちた)ときに永遠に待ってしまう
    // コマンドが見つからないときは exit ではなく error が来る
    const finished = new Promise<void>((resolve) => {
        child.once("exit", () => {
            exited = true;
            resolve();
        });
        child.once("error", (err) => {
            exited = true;
            ok = false;
            console.log(`  FAIL 起動できませんでした: ${err.message}`);
            resolve();
        });
    });
    try {
        await waitForServer(() => exited);
        for (const check of CHECKS) {
            const res = await fetch(`${BASE}${check.path}`, check.init);
            const body = await res.text();
            const cookies = res.headers.getSetCookie();
            const pass =
                res.status === check.status &&
                (check.body === undefined || body === check.body) &&
                (check.cookies === undefined || JSON.stringify(cookies) === JSON.stringify(check.cookies));
            if (!pass) ok = false;
            console.log(`  ${pass ? "ok  " : "FAIL"} ${check.name}: ${res.status} ${JSON.stringify(body.slice(0, 60))}`);
        }
        for (const check of RAW_CHECKS) {
            const status = await sendRaw(check.request);
            const pass = status === check.status;
            if (!pass) ok = false;
            console.log(`  ${pass ? "ok  " : "FAIL"} ${check.name}: ${status}`);
        }
    } catch (err) {
        ok = false;
        console.log(`  FAIL ${err instanceof Error ? err.message : String(err)}`);
        if (stderr) console.log(stderr);
    } finally {
        child.kill();
        await finished;
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
// process.exit() で強制終了すると、Windows では子プロセスの後片付け中に libuv が落ちることがあるので、
// 終了コードだけ決めて自然に終わらせる
process.exitCode = allOk ? 0 : 1;
