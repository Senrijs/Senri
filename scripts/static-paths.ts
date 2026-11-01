// serveStatic(adapters/static)のパスの扱いを、Bun / Deno / Node で実際に HTTP で確かめる
// 使い方: node scripts/static-paths.ts [bun] [deno] [node]   (省略すると全部)
// - 生のリクエスト行を送る(fetch だと "/../" などがクライアントで正規化されて、サーバーに届かない)
// - Windows / macOS は綴りが違っても同じファイルを開く。とくに Deno は Windows で末尾の . や空白を取り除くので、
//   test/static.test.ts(Bun で動く)だけでは確かめられない。CI の static-os ジョブで動かす
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = join(import.meta.dirname, "static-paths-app.ts");
const RUNTIMES: Record<string, { command: string[]; port: number }> = {
    bun: { command: ["bun", "run", APP], port: 3950 },
    deno: { command: ["deno", "run", "--allow-net", "--allow-read", APP], port: 3951 },
    node: { command: ["node", APP], port: 3952 },
};

// [パス, ステータス]。200 以外では、root の外(outside)や admin/ の中身(admin-secret)を返さないことも確かめる
const CHECKS: [string, number][] = [
    ["/app.js", 200],
    ["/admin/secret.txt", 401],
    ["/../secret.txt", 404],
    ["/%2e%2e/secret.txt", 404],
    ["/..%2fsecret.txt", 400],
    ["/%252e%252e/secret.txt", 404],
    ["/%zz", 400],
    // 綴りを変えて /admin のミドルウェアを飛ばせない(Windows / macOS で意味がある)
    ["/ADMIN/secret.txt", 404],
    // 末尾の . や空白(Windows の Deno で意味がある)
    ["/admin./secret.txt", 404],
    ["/app.js.", 404],
    ["/app.js%20", 404],
];

function get(port: number, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let data = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => (data += chunk));
        socket.on("error", reject);
        socket.on("end", () => {
            const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);
            resolve({ status, body: data.slice(data.indexOf("\r\n\r\n") + 4) });
        });
        socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error("サーバーが起動前に終了しました");
        try {
            await get(port, "/app.js");
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    throw new Error("サーバーが起動しませんでした");
}

const dir = mkdtempSync(join(tmpdir(), "senri-static-paths-"));
const root = join(dir, "public");
mkdirSync(join(root, "admin"), { recursive: true });
writeFileSync(join(root, "app.js"), "app");
writeFileSync(join(root, "admin", "secret.txt"), "admin-secret");
writeFileSync(join(dir, "secret.txt"), "outside");

const selected = process.argv.slice(2);
const names = selected.length > 0 ? selected : Object.keys(RUNTIMES);
let failed = false;
try {
    for (const name of names) {
        const runtime = RUNTIMES[name];
        if (!runtime) throw new Error(`知らないランタイムです: ${name}`);
        console.log(`[${name}]`);
        const [cmd, ...args] = runtime.command;
        const child = spawn(cmd!, [...args, root, String(runtime.port)], { stdio: ["ignore", "ignore", "inherit"] });
        try {
            await waitForServer(runtime.port, child);
            for (const [path, status] of CHECKS) {
                const res = await get(runtime.port, path);
                const leaked = status !== 200 && /outside|admin-secret/.test(res.body);
                const ok = res.status === status && !leaked;
                if (!ok) failed = true;
                console.log(`  ${ok ? "ok" : "NG"}   ${path}: ${res.status}${ok ? "" : ` (期待: ${status}${leaked ? "、中身が漏れた" : ""})`}`);
            }
        } finally {
            // 止まるまで待つ(Windows では、動いているあいだは一時フォルダを消せない)
            if (child.exitCode === null) {
                const exited = new Promise((r) => child.once("exit", r));
                child.kill();
                await exited;
            }
        }
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
