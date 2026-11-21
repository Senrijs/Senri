// senri build --target docker が書いた Dockerfile で、実際にイメージを作って起動し、HTTP と止まり方を確かめる
// 使い方: node scripts/smoke-cli.ts [bun] [node] [deno]   (省略すると全部)
// - アプリは create-senri のテンプレートで作り、health() を足す(k8s のプローブと同じパスを確かめるため)
// - @senrijs/senri は、テンプレートの範囲で npm / JSR から入る(CLI は本体の版に縛られないので、公開済みのもので確かめる)
// - Kubernetes と同じ制限で動かす: 読み込み専用のファイルシステム(/tmp だけ書ける)、権限なし、root 以外
// - DOCKER=podman で、docker の代わりに podman を使う
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CREATE = join(ROOT, "packages/create-senri/index.js");
const SENRI = join(ROOT, "packages/cli/bin/senri.js");
const DOCKER = process.env.DOCKER ?? "docker";

const TARGETS: Record<string, { entry: string }> = {
    bun: { entry: "src/index.ts" },
    node: { entry: "src/index.ts" },
    deno: { entry: "src/main.ts" },
};

// ホストの空いているポート(決め打ちにすると、ほかのサーバーに繋がってしまうことがある)
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
        });
    });
}

function run(command: string, args: string[], cwd = ROOT) {
    const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} が失敗しました\n${result.stdout}\n${result.stderr ?? result.error?.message}`);
    }
    return result.stdout.trim();
}

async function waitFor(url: string): Promise<Response> {
    for (let i = 0; i < 100; i++) {
        try {
            return await fetch(url);
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error(`${url} に繋がりませんでした`);
}

async function smoke(name: string, work: string): Promise<boolean> {
    const { entry } = TARGETS[name]!;
    const port = await freePort();
    const project = join(work, `app-${name}`);
    const image = `senri-smoke-cli-${name}`;
    run(process.execPath, [CREATE, project, "--template", name]);
    // health() を足す
    const path = join(project, entry);
    const source = readFileSync(path, "utf8")
        .replace('import { createApp } from "@senrijs/senri";', 'import { createApp, health } from "@senrijs/senri";')
        .replace('app.get("/", ', 'app.use(health());\napp.get("/", ');
    if (!source.includes("app.use(health())")) throw new Error(`${entry} に health() を足せませんでした`);
    writeFileSync(path, source);

    console.log(run(process.execPath, [SENRI, "build", "--target", "docker", "--target", "k8s"], project).split("\n").slice(0, 4).join("\n"));
    const started = Date.now();
    run(DOCKER, ["build", "-q", "-t", image, "."], project);
    const size = Number(run(DOCKER, ["image", "inspect", image, "--format", "{{.Size}}"]));
    console.log(`  built in ${Math.round((Date.now() - started) / 1000)} s, ${Math.round(size / 1e6)} MB`);

    const id = run(DOCKER, [
        "run", "-d", "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "-p", `127.0.0.1:${port}:3927`, image,
    ]);
    let ok = true;
    const check = (label: string, pass: boolean, detail: string) => {
        console.log(`  ${pass ? "ok  " : "FAIL"} ${label}: ${detail}`);
        if (!pass) ok = false;
    };
    try {
        const base = `http://127.0.0.1:${port}`;
        const t0 = Date.now();
        const live = await waitFor(`${base}/healthz`);
        check("GET /healthz", live.status === 200, `${live.status} (${Date.now() - t0} ms after docker run)`);
        const ready = await fetch(`${base}/readyz`);
        check("GET /readyz", ready.status === 200, String(ready.status));
        const root = await fetch(`${base}/`);
        const body = await root.text();
        check("GET /", root.status === 200 && body === "Hello, Senri!", `${root.status} ${JSON.stringify(body)}`);

        // SIGTERM で、serve() が自分で止まる(SIGKILL まで待たない)
        const t1 = Date.now();
        run(DOCKER, ["stop", "-t", "20", id]);
        const stopped = Date.now() - t1;
        const code = run(DOCKER, ["inspect", id, "--format", "{{.State.ExitCode}}"]);
        check("SIGTERM", code === "0" && stopped < 15_000, `exit code ${code} after ${stopped} ms`);
    } catch (err) {
        ok = false;
        console.log(`  FAIL ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        if (!ok) console.log(spawnSync(DOCKER, ["logs", id], { encoding: "utf8" }).stdout);
        spawnSync(DOCKER, ["rm", "-f", id]);
        spawnSync(DOCKER, ["rmi", "-f", image]);
    }
    return ok;
}

const selected = process.argv.slice(2);
const names = selected.length > 0 ? selected : Object.keys(TARGETS);
for (const name of names) if (!TARGETS[name]) throw new Error(`知らないランタイムです: ${name}`);

const work = mkdtempSync(join(tmpdir(), "senri-smoke-cli-"));
let allOk = true;
try {
    for (const name of names) {
        console.log(`[senri build --target docker: ${name}]`);
        if (!(await smoke(name, work))) allOk = false;
    }
} finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exitCode = allOk ? 0 : 1;
