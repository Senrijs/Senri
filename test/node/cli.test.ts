// @senrijs/cli(packages/cli)の senri コマンドを、子プロセスで動かして確かめる
// 作ったイメージを実際に起動して確かめるのは scripts/smoke-cli.ts(CI の cli-docker)
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = join(ROOT, "packages/cli/bin/senri.js");
const VERSION = JSON.parse(readFileSync(join(ROOT, "packages/cli/package.json"), "utf8")).version;
const work = mkdtempSync(join(tmpdir(), "senri-cli-"));
after(() => rmSync(work, { recursive: true, force: true }));

function run(cwd: string, args: string[]) {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", input: "" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function has(command: string): boolean {
    return spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0;
}

let count = 0;
// files のファイルを持ったプロジェクトのフォルダを作る
function project(files: Record<string, string>): string {
    const dir = join(work, `p${count++}`);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
    mkdirSync(dir, { recursive: true });
    return dir;
}

const APP = `import { createApp, health } from "@senrijs/senri";
import { serve } from "@senrijs/senri/serve";
const app = createApp();
app.use(health());
app.get("/", () => "hi");
serve(app);
`;
const pkg = (extra: object = {}) => JSON.stringify({ name: "@acme/My_App", version: "1.2.3", type: "module", ...extra });
const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");

describe("senri", () => {
    test("--help に build が出る。まだないコマンド(dev・replay)は出さない", () => {
        const res = run(work, ["--help"]);
        assert.equal(res.status, 0);
        assert.match(res.stdout, /build/);
        assert.doesNotMatch(res.stdout, /\bdev\b|\breplay\b/);
    });

    test("--version は package.json の version", () => {
        assert.equal(run(work, ["--version"]).stdout.trim(), VERSION);
    });

    test("知らないコマンドは、終了コード 1", () => {
        const res = run(work, ["deploy"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /Unknown command: "deploy"/);
    });
});

describe("senri build", () => {
    test("--target がなければ、終了コード 1", () => {
        const res = run(project({ "package.json": pkg() }), ["build"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /Pass --target/);
    });

    test("知らない target・おかしい --port は、終了コード 1", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.match(run(dir, ["build", "-t", "heroku"]).stderr, /Unknown target: "heroku"/);
        assert.match(run(dir, ["build", "-t", "docker", "--port", "70000"]).stderr, /--port must be/);
        assert.match(run(dir, ["build", "-t", "docker", "--port", "3e3"]).stderr, /--port must be/);
        assert.match(run(dir, ["build", "-t", "k8s", "--health-path", "healthz"]).stderr, /must be a path/);
        assert.ok(!existsSync(join(dir, "Dockerfile")));
    });

    test("そのターゲットで使わないフラグは、黙って無視せずに終了コード 1", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.match(run(dir, ["build", "-t", "workers", "--port", "8080"]).stderr, /--port is used only with --target docker or k8s/);
        assert.match(run(dir, ["build", "-t", "docker", "--image", "x"]).stderr, /--image is used only with --target k8s/);
        assert.match(run(dir, ["build", "-t", "k8s", "--runtime", "bun"]).stderr, /--runtime is used only with --target docker/);
        assert.ok(!existsSync(join(dir, "Dockerfile")) && !existsSync(join(dir, "wrangler.jsonc")));
    });

    test("workers は docker・k8s と一緒に使えない", () => {
        const res = run(project({ "package.json": pkg(), "src/index.ts": APP }), ["build", "-t", "workers", "-t", "docker"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /cannot be combined/);
    });
});

describe("senri build --target docker", () => {
    test("ランタイムの推測: bun.lock → bun、start が bun → bun、deno.json → deno、それ以外 → node", () => {
        const cases: [Record<string, string>, string, RegExp][] = [
            [{ "package.json": pkg(), "bun.lock": "{}", "src/index.ts": APP }, "bun", /found bun\.lock/],
            [{ "package.json": pkg({ scripts: { start: "bun src/index.ts" } }), "src/index.ts": APP }, "bun", /scripts\.start/],
            [{ "package.json": pkg({ packageManager: "bun@1.3.0" }), "src/index.ts": APP }, "bun", /packageManager/],
            [{ "deno.json": "{}", "src/main.ts": APP }, "deno", /found deno\.json/],
            [{ "package.json": pkg(), "src/index.ts": APP }, "node", /found package\.json/],
        ];
        for (const [files, runtime, reason] of cases) {
            const res = run(project(files), ["build", "-t", "docker", "--dry-run"]);
            assert.equal(res.status, 0, res.stderr);
            const line = res.stdout.split("\n").find((l) => l.includes("Runtime:")) ?? "";
            assert.ok(line.includes(`Runtime: ${runtime} `), line);
            assert.match(line, reason);
        }
    });

    test("--runtime で決められる。知らないランタイムは、終了コード 1", () => {
        const dir = project({ "package.json": pkg(), "bun.lock": "{}", "src/index.ts": APP });
        assert.match(run(dir, ["build", "-t", "docker", "--runtime", "node", "--dry-run"]).stdout, /Runtime: node \(--runtime\)/);
        assert.match(run(dir, ["build", "-t", "docker", "--runtime", "python"]).stderr, /Unknown runtime: "python"/);
    });

    test("bun: 1 つのファイルにまとめて、distroless で root 以外で動かす", () => {
        const dir = project({ "package.json": pkg(), "bun.lock": "{}", "src/index.ts": APP });
        const res = run(dir, ["build", "-t", "docker"]);
        assert.equal(res.status, 0, res.stderr);
        const file = read(dir, "Dockerfile");
        const header = `# Generated by \`senri build --target docker\` (@senrijs/cli ${VERSION}).\n`;
        assert.ok(file.startsWith(header), file.slice(0, file.indexOf("\n")));
        assert.match(file, /^FROM oven\/bun:1 AS build$/m);
        assert.match(file, /^RUN bun install --frozen-lockfile$/m);
        assert.match(file, /^RUN bun build src\/index\.ts --target bun --minify --outfile \/out\/server\.js$/m);
        assert.match(file, /^FROM oven\/bun:1-distroless$/m);
        assert.match(file, /^USER 65532:65532$/m);
        assert.match(file, /^ENV PORT=3927$/m);
        assert.match(file, /^EXPOSE 3927$/m);
        assert.match(file, /^CMD \["server\.js"\]$/m);
        // 前提をコメントに書く
        assert.match(file, /Port: 3927/);
        assert.match(file, /docker stop -t 20/);
        assert.match(read(dir, ".dockerignore"), /^node_modules$/m);
        assert.match(read(dir, ".dockerignore"), /^\.env$/m);
        assert.match(res.stdout, /created {6}Dockerfile/);
    });

    test("node: ロックファイルで依存の入れ方を変える。yarn はまだ断る", () => {
        const base = { "package.json": pkg({ scripts: { start: "node src/server.ts" } }), "src/server.ts": APP };
        const npm = project({ ...base, "package-lock.json": "{}" });
        assert.equal(run(npm, ["build", "-t", "docker"]).status, 0);
        const file = read(npm, "Dockerfile");
        assert.match(file, /^RUN npm ci --omit=dev$/m);
        assert.match(file, /^FROM gcr\.io\/distroless\/nodejs24-debian12:nonroot$/m);
        assert.match(file, /^CMD \["src\/server\.ts"\]$/m);

        const pnpm = project({ ...base, "pnpm-lock.yaml": "" });
        assert.equal(run(pnpm, ["build", "-t", "docker"]).status, 0);
        assert.match(read(pnpm, "Dockerfile"), /pnpm install --prod --frozen-lockfile/);

        const none = project(base);
        assert.equal(run(none, ["build", "-t", "docker"]).status, 0);
        assert.match(read(none, "Dockerfile"), /^RUN npm install --omit=dev$/m);
        assert.match(read(none, "Dockerfile"), /WITHOUT a lockfile/);

        const yarn = project({ ...base, "yarn.lock": "" });
        const res = run(yarn, ["build", "-t", "docker"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /yarn\.lock is not supported/);
        assert.ok(!existsSync(join(yarn, "Dockerfile")));
    });

    test("deno: tasks.start のフラグを使い、--watch は持ち込まない", () => {
        const dir = project({
            "deno.json": JSON.stringify({ tasks: { start: "deno run --watch --allow-net --allow-env=PORT src/app.ts" } }),
            "deno.lock": "{}",
            "src/app.ts": APP,
        });
        const res = run(dir, ["build", "-t", "docker"]);
        assert.equal(res.status, 0, res.stderr);
        const file = read(dir, "Dockerfile");
        assert.match(file, /^CMD \["run","--allow-net","--allow-env=PORT","src\/app\.ts"\]$/m);
        assert.match(file, /^RUN deno install --frozen --entrypoint src\/app\.ts$/m);
        assert.match(file, /^FROM denoland\/deno:distroless-(?:\d+\.\d+\.\d+|latest)$/m);
        assert.match(file, /from tasks\.start in deno\.json/);
    });

    test("--port を、PORT・EXPOSE に使う", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.equal(run(dir, ["build", "-t", "docker", "--port", "8080"]).status, 0);
        assert.match(read(dir, "Dockerfile"), /^ENV PORT=8080\nEXPOSE 8080$/m);
    });

    test("devtools() を import していたら、知らせる", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": `import { devtools } from "@senrijs/senri/dev";\n${APP}` });
        assert.match(run(dir, ["build", "-t", "docker"]).stdout, /note: src\/index\.ts imports devtools\(\)/);
    });
});

describe("既にあるファイル", () => {
    test("1 つでもあれば、どれも書かずに終了コード 1(中身はそのまま)", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP, Dockerfile: "FROM mine\n" });
        const res = run(dir, ["build", "-t", "docker", "-t", "k8s"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /already exist, so nothing was written:\n {2}Dockerfile/);
        assert.equal(read(dir, "Dockerfile"), "FROM mine\n");
        assert.ok(!existsSync(join(dir, "k8s")));
        assert.ok(!existsSync(join(dir, ".dockerignore")));
    });

    test(".dockerignore は、あればそのまま使う(そう表示する)", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP, ".dockerignore": "mine\n" });
        const res = run(dir, ["build", "-t", "docker"]);
        assert.equal(res.status, 0, res.stderr);
        assert.equal(read(dir, ".dockerignore"), "mine\n");
        assert.match(res.stdout, /kept {9}\.dockerignore/);
    });

    test("--force なら上書きし、上書きしたファイルを出す", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP, Dockerfile: "FROM mine\n", ".dockerignore": "mine\n" });
        const res = run(dir, ["build", "-t", "docker", "--force"]);
        assert.equal(res.status, 0, res.stderr);
        assert.match(read(dir, "Dockerfile"), /^# Generated by/);
        assert.match(res.stdout, /overwrote {4}Dockerfile \(--force\)/);
        assert.match(res.stdout, /overwrote {4}\.dockerignore \(--force\)/);
    });

    test("--dry-run は何も書かず、中身を出す", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP, Dockerfile: "FROM mine\n" });
        const res = run(dir, ["build", "-t", "k8s", "--dry-run"]);
        assert.equal(res.status, 0, res.stderr);
        assert.match(res.stdout, /--- k8s\/deployment\.yaml \(would create\) ---\n# Generated by/);
        assert.match(res.stdout, /Dry run: nothing was written/);
        assert.ok(!existsSync(join(dir, "k8s")));
    });
});

describe("senri build --target k8s", () => {
    test("terminationGracePeriodSeconds = preStop + shutdownTimeout + 5 秒", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.equal(run(dir, ["build", "-t", "k8s"]).status, 0);
        const file = read(dir, "k8s/deployment.yaml");
        assert.match(file, /^ {6}terminationGracePeriodSeconds: 20$/m);
        assert.match(file, /^ {12}preStop:\n {14}sleep:\n {16}seconds: 5$/m);
        assert.match(file, /Kubernetes 1\.30 or later/);

        const longer = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.equal(run(longer, ["build", "-t", "k8s", "--shutdown-timeout", "30000", "--pre-stop-sleep", "10"]).status, 0);
        assert.match(read(longer, "k8s/deployment.yaml"), /^ {6}terminationGracePeriodSeconds: 45$/m);
    });

    test("--pre-stop-sleep 0 なら preStop を書かず、何が起きうるかを書く(Kubernetes 1.30 より前のクラスター向け)", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        const res = run(dir, ["build", "-t", "k8s", "--pre-stop-sleep", "0"]);
        assert.equal(res.status, 0, res.stderr);
        const file = read(dir, "k8s/deployment.yaml");
        assert.doesNotMatch(file, /lifecycle:/);
        assert.match(file, /No preStop \(--pre-stop-sleep 0\)/);
        assert.match(file, /^ {6}terminationGracePeriodSeconds: 15$/m);
        assert.doesNotMatch(res.stdout, /Kubernetes 1\.30/);
    });

    test("名前は package.json の name から(scope を外し、Kubernetes で使える形に)。イメージは name:version", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.equal(run(dir, ["build", "-t", "k8s"]).status, 0);
        const file = read(dir, "k8s/deployment.yaml");
        assert.match(file, /^ {2}name: "my-app"$/m);
        assert.match(file, /^ {10}image: "my-app:1\.2\.3"$/m);

        const other = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.equal(run(other, ["build", "-t", "k8s", "--image", "ghcr.io/acme/app:sha-1"]).status, 0);
        assert.match(read(other, "k8s/deployment.yaml"), /^ {10}image: "ghcr\.io\/acme\/app:sha-1"$/m);
    });

    test("health() が見つからなければ、知らせる", () => {
        const without = project({ "package.json": pkg(), "src/index.ts": 'import { createApp } from "@senrijs/senri";\n' });
        assert.match(run(without, ["build", "-t", "k8s"]).stdout, /note: Did not find health\(\) in src\//);
        // エントリーとは別のファイルにあってもよい
        const split = project({ "package.json": pkg(), "src/index.ts": "import './app.ts';\n", "src/app.ts": APP });
        assert.doesNotMatch(run(split, ["build", "-t", "k8s"]).stdout, /Did not find health/);
    });

    test("YAML として読めて、プローブ・ポート・Service が噛み合っている", { skip: !has("bun") && "bun がない" }, () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        assert.equal(run(dir, ["build", "-t", "k8s", "--port", "8080", "--ready-path", "/ready"]).status, 0);
        const script = `
            const [d, s] = ["k8s/deployment.yaml", "k8s/service.yaml"].map((f) => Bun.YAML.parse(require("fs").readFileSync(f, "utf8")));
            console.log(JSON.stringify({ d, s }));
        `;
        const out = spawnSync("bun", ["-e", script], { cwd: dir, encoding: "utf8" });
        assert.equal(out.status, 0, out.stderr);
        const { d, s } = JSON.parse(out.stdout);
        assert.equal(d.kind, "Deployment");
        assert.equal(s.kind, "Service");
        const pod = d.spec.template.spec;
        const c = pod.containers[0];
        assert.deepEqual(d.spec.selector.matchLabels, d.spec.template.metadata.labels);
        assert.deepEqual(s.spec.selector, d.spec.template.metadata.labels);
        assert.equal(c.ports[0].containerPort, 8080);
        assert.equal(c.env.find((e: { name: string }) => e.name === "PORT").value, "8080");
        assert.equal(c.livenessProbe.httpGet.path, "/healthz");
        assert.equal(c.readinessProbe.httpGet.path, "/ready");
        assert.equal(c.livenessProbe.httpGet.port, c.ports[0].name);
        assert.equal(s.spec.ports[0].targetPort, c.ports[0].name);
        assert.equal(c.lifecycle.preStop.sleep.seconds, 5);
        assert.equal(pod.terminationGracePeriodSeconds, 20);
        assert.equal(pod.securityContext.runAsUser, 65532);
        assert.equal(c.securityContext.readOnlyRootFilesystem, true);
    });
});

describe("senri build --target workers", () => {
    test("wrangler の設定がなければ wrangler.jsonc を作る(前提はコメントに)", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": "export default {};\n" });
        const res = run(dir, ["build", "-t", "workers"]);
        assert.equal(res.status, 0, res.stderr);
        const file = read(dir, "wrangler.jsonc");
        assert.match(file, /^\/\/ Generated by `senri build --target workers`/);
        assert.match(file, /"name": "my-app"/);
        assert.match(file, /"main": "src\/index\.ts"/);
        assert.match(file, /"compatibility_date": "\d{4}-\d{2}-\d{2}"/);
        assert.match(file, /the day this file was written \(UTC\)/);
        // wrangler が入っていなければ、まとめずに、どうすればよいかを出す
        assert.match(res.stdout, /Did not bundle: wrangler is not installed/);
    });

    test("既にある wrangler の設定は書き換えず、main をエントリーに使う", () => {
        const config = '{\n  // my worker\n  "name": "x", "main": "./src/worker.ts", // "main": "no"\n}\n';
        const dir = project({ "package.json": pkg(), "wrangler.jsonc": config, "src/worker.ts": "export default {};\n" });
        const res = run(dir, ["build", "-t", "workers"]);
        assert.equal(res.status, 0, res.stderr);
        assert.equal(read(dir, "wrangler.jsonc"), config);
        assert.match(res.stdout, /Entry: src\/worker\.ts \(main in wrangler\.jsonc\)/);
        assert.match(res.stdout, /kept as it is/);
        // 設定と --entry がぶつかるときは、黙ってどちらかを選ばない
        assert.match(run(dir, ["build", "-t", "workers", "--entry", "src/worker.ts"]).stderr, /already sets the entry/);
    });

    test("export default がない・serve() を使っているなら、知らせる", () => {
        const dir = project({ "package.json": pkg(), "src/index.ts": APP });
        const res = run(dir, ["build", "-t", "workers"]);
        assert.equal(res.status, 0, res.stderr);
        assert.match(res.stdout, /has no `export default`/);
        assert.match(res.stdout, /imports @senrijs\/senri\/serve/);
    });
});
