// create-senri のテンプレートで実際にプロジェクトを作り、起動して HTTP で確かめる
// 使い方: node scripts/smoke-create.ts [bun] [node] [deno] [workers]   (省略すると全部)
// - @senrijs/senri は、このリポジトリを npm pack した tarball を入れる(まだ npm にない変更でも確かめられるように)
// - Deno は jsr: を使うので tarball は入れられない。deno.json の imports を、このリポジトリの src に向ける
// - Workers は、テンプレートの wrangler は入れずに、このリポジトリの wrangler(devDependencies)で wrangler dev を動かす
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "packages/create-senri/index.js");
const WIN = process.platform === "win32";

type Target = { port: number; install?: string[]; start: (port: number) => string[] };
const TARGETS: Record<string, Target> = {
    bun: { port: 3941, install: ["bun", "install"], start: () => ["bun", "src/index.ts"] },
    node: { port: 3942, install: ["npm", "install", "--no-audit", "--no-fund"], start: () => [process.execPath, "src/index.ts"] },
    deno: { port: 3943, start: () => ["deno", "run", "--allow-net", "--allow-env=PORT,NODE_ENV", "src/main.ts"] },
    workers: {
        port: 3944,
        install: ["npm", "install", "--no-audit", "--no-fund"],
        start: (port) => [process.execPath, join(ROOT, "node_modules/wrangler/bin/wrangler.js"), "dev", "--ip", "127.0.0.1", "--port", String(port)],
    },
};

// Windows の npm は npm.cmd なので、シェルを通して動かす(1つの文字列にして渡す。引数に空白や記号はない)
function spawnTool(command: string[], cwd: string) {
    const [cmd, ...args] = command;
    if (WIN && cmd === "npm") return spawnSync(command.join(" "), { cwd, encoding: "utf8", shell: true });
    return spawnSync(cmd!, args, { cwd, encoding: "utf8" });
}

function run(command: string[], cwd: string): void {
    const result = spawnTool(command, cwd);
    if (result.status !== 0) {
        throw new Error(`${command.join(" ")} が失敗しました\n${result.stdout}\n${result.stderr ?? result.error?.message}`);
    }
}

// 子プロセスごと止める(wrangler は workerd を子として起動するので、親だけ止めると残る)
function stop(child: ChildProcess): void {
    if (child.exitCode !== null || child.pid === undefined) return;
    if (WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, "SIGTERM");
}

async function waitFor(url: string, exited: () => boolean): Promise<Response> {
    // wrangler dev は起動に時間がかかる
    for (let i = 0; i < 150; i++) {
        if (exited()) throw new Error("サーバーが起動前に終了しました");
        try {
            return await fetch(url);
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error("サーバーが起動しませんでした");
}

// 本体をビルドして npm pack する(dist/ が npm のパッケージの中身)
function pack(dir: string): string {
    run(["bun", "run", "build"], ROOT);
    const result = spawnTool(["npm", "pack", "--json", "--pack-destination", dir], ROOT);
    if (result.status !== 0) throw new Error(`npm pack が失敗しました\n${result.stderr}`);
    const [info] = JSON.parse(result.stdout) as { filename: string }[];
    return join(dir, info!.filename);
}

// 作ったプロジェクトの @senrijs/senri を、tarball(Deno はこのリポジトリの src)に差し替える
function useLocalSenri(name: string, project: string, tarball: string): void {
    if (name === "deno") {
        const path = join(project, "deno.json");
        const config = JSON.parse(readFileSync(path, "utf8"));
        const at = (file: string) => pathToFileURL(join(ROOT, file)).href;
        config.imports = {
            "@senrijs/senri": at("src/index.ts"),
            "@senrijs/senri/dev": at("src/dev/index.ts"),
            "@senrijs/senri/serve": at("adapters/serve/index.ts"),
        };
        writeFileSync(path, JSON.stringify(config, null, 2));
        return;
    }
    const path = join(project, "package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    pkg.dependencies["@senrijs/senri"] = `file:${tarball}`;
    // Workers の wrangler は入れない(このリポジトリのものを使う)
    delete pkg.devDependencies;
    writeFileSync(path, JSON.stringify(pkg, null, 2));
}

async function smoke(name: string, work: string, tarball: string): Promise<boolean> {
    const target = TARGETS[name]!;
    const project = join(work, `app-${name}`);
    const created = spawnSync(process.execPath, [CLI, project, "--template", name], { encoding: "utf8" });
    if (created.status !== 0) {
        console.log(`  FAIL 作れませんでした\n${created.stderr}`);
        return false;
    }
    useLocalSenri(name, project, tarball);
    if (target.install) run(target.install, project);

    const [cmd, ...args] = target.start(target.port);
    const child = spawn(cmd!, args, {
        cwd: project,
        stdio: ["ignore", "pipe", "pipe"],
        detached: !WIN,
        env: { ...process.env, PORT: String(target.port), WRANGLER_SEND_METRICS: "false" },
    });
    let output = "";
    child.stdout!.on("data", (d) => (output += d));
    child.stderr!.on("data", (d) => (output += d));
    let exited = false;
    const finished = new Promise<void>((resolve) => {
        child.once("exit", () => ((exited = true), resolve()));
        child.once("error", (err) => ((exited = true), (output += String(err)), resolve()));
    });

    let ok = true;
    try {
        const base = `http://127.0.0.1:${target.port}`;
        const root = await waitFor(`${base}/`, () => exited);
        const body = await root.text();
        const rootOk = root.status === 200 && body === "Hello, Senri!";
        console.log(`  ${rootOk ? "ok  " : "FAIL"} GET /: ${root.status} ${JSON.stringify(body)}`);
        const user = await fetch(`${base}/users/42`);
        const json = await user.text();
        const userOk = user.status === 200 && json === `{"id":"42"}`;
        console.log(`  ${userOk ? "ok  " : "FAIL"} GET /users/42: ${user.status} ${json}`);
        ok = rootOk && userOk;
    } catch (err) {
        ok = false;
        console.log(`  FAIL ${err instanceof Error ? err.message : String(err)}\n${output}`);
    } finally {
        stop(child);
        await finished;
    }
    return ok;
}

const selected = process.argv.slice(2);
const names = selected.length > 0 ? selected : Object.keys(TARGETS);
for (const name of names) if (!TARGETS[name]) throw new Error(`知らないテンプレートです: ${name}`);

const work = mkdtempSync(join(tmpdir(), "senri-create-"));
let allOk = true;
try {
    const tarball = pack(work);
    for (const name of names) {
        console.log(`[create-senri: ${name}]`);
        if (!(await smoke(name, work, tarball))) allOk = false;
    }
} finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exitCode = allOk ? 0 : 1;
