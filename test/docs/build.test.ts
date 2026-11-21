// ドキュメントの「本番 → ビルド」(production/build)に書いた、senri build(packages/cli)の動き
import { afterAll, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, health } from "../../src/index.ts";
import { DEFAULT_PORT } from "../../adapters/serve/port.ts";
import { claim, req } from "./claim.ts";

const ROOT = join(import.meta.dir, "../..");
const CLI = join(ROOT, "packages/cli/bin/senri.js");
const work = mkdtempSync(join(tmpdir(), "senri-docs-build-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

let count = 0;
function project(files: Record<string, string> = {}): string {
    const dir = join(work, `p${count++}`);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", version: "1.0.0" }));
    writeFileSync(join(dir, "src/index.ts"), 'import { health } from "@senrijs/senri";\napp.use(health());\n');
    for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
    return dir;
}

function senri(cwd: string, args: string[]) {
    const result = Bun.spawnSync(["node", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    return { status: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

claim("production/build#no-overwrite", "既にあるファイルが 1 つでもあれば、どれも書かずに終了コード 1", () => {
    const dir = project({ Dockerfile: "FROM mine\n" });
    const res = senri(dir, ["build", "--target", "docker", "--target", "k8s"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("nothing was written");
    expect(readFileSync(join(dir, "Dockerfile"), "utf8")).toBe("FROM mine\n");
    expect(existsSync(join(dir, "k8s"))).toBe(false);
});

claim("production/build#defaults", "ポート・ヘルスチェックのパス・shutdownTimeout の既定が、serve() と health() に合っている", async () => {
    const dir = project();
    expect(senri(dir, ["build", "--target", "docker", "--target", "k8s"]).status).toBe(0);
    const dockerfile = readFileSync(join(dir, "Dockerfile"), "utf8");
    const deployment = readFileSync(join(dir, "k8s/deployment.yaml"), "utf8");
    expect(dockerfile).toContain(`ENV PORT=${DEFAULT_PORT}\n`);
    expect(deployment).toContain(`containerPort: ${DEFAULT_PORT}\n`);
    // health() の既定のパス(/readyz は止まり始めていると 503 なので、health() が答えている=404 でない、を見る)
    const app = createApp();
    app.use(health());
    for (const path of ["/healthz", "/readyz"]) {
        expect(deployment).toContain(`path: "${path}"`);
        expect((await req(app, "GET", path)).status).not.toBe(404);
    }
    expect((await req(app, "GET", "/livez")).status).toBe(404);
    // serve() の shutdownTimeout の既定(10 秒)
    expect(readFileSync(join(ROOT, "adapters/serve/index.ts"), "utf8")).toContain("options.shutdownTimeout ?? 10_000");
    expect(deployment).toContain("shutdownTimeout in serve() is 10000 ms (the default)");
});

claim("production/build#grace", "terminationGracePeriodSeconds は preStop + shutdownTimeout + 5 秒", () => {
    const grace = (args: string[]) => {
        const dir = project();
        expect(senri(dir, ["build", "--target", "k8s", ...args]).status).toBe(0);
        return Number(/terminationGracePeriodSeconds: (\d+)\n/.exec(readFileSync(join(dir, "k8s/deployment.yaml"), "utf8"))?.[1]);
    };
    expect(grace([])).toBe(5 + 10 + 5);
    expect(grace(["--shutdown-timeout", "30000"])).toBe(5 + 30 + 5);
    expect(grace(["--pre-stop-sleep", "0"])).toBe(0 + 10 + 5);
});

claim("production/build#no-prestop", "--pre-stop-sleep 0 なら preStop を書かない", () => {
    const dir = project();
    expect(senri(dir, ["build", "--target", "k8s", "--pre-stop-sleep", "0"]).status).toBe(0);
    const deployment = readFileSync(join(dir, "k8s/deployment.yaml"), "utf8");
    expect(deployment).not.toContain("lifecycle:");
    expect(deployment).not.toContain("preStop:");
});
