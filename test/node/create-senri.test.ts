// create-senri(packages/create-senri)の CLI を、子プロセスで動かして確かめる
// 実際に起動して HTTP で確かめるのは scripts/smoke-create.ts
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SENRI_RANGE } from "../../packages/create-senri/version.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = join(ROOT, "packages/create-senri/index.js");
const TEMPLATES = ["bun", "node", "deno", "workers"];
const work = mkdtempSync(join(tmpdir(), "create-senri-"));
after(() => rmSync(work, { recursive: true, force: true }));

// stdin は空(端末ではない)にして動かす
// npm_config_user_agent は消す(bun run test:node で動かすと bun のものが入り、次の一歩のコマンドが bun になるため)
function run(args: string[], command = process.execPath, extra: string[] = []) {
    const env = { ...process.env, npm_config_user_agent: "" };
    const result = spawnSync(command, [...extra, CLI, ...args], { cwd: work, encoding: "utf8", input: "", env });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// "^0.2.2" のような範囲が、version を満たすか(0.x では、マイナーが同じで、パッチ以上)
function satisfiesCaret(range: string, version: string): boolean {
    const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
    const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!m || !v) throw new Error(`Unsupported range or version: ${range} ${version}`);
    const [a, b, c] = m.slice(1).map(Number) as [number, number, number];
    const [x, y, z] = v.slice(1).map(Number) as [number, number, number];
    if (a > 0) return x === a && (y > b || (y === b && z >= c));
    if (b > 0) return x === 0 && y === b && z >= c;
    return x === 0 && y === 0 && z === c;
}

// コマンドがあるか(CI のジョブによっては Bun / Deno がない)
function has(command: string): boolean {
    return spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0;
}

describe("create-senri", () => {
    for (const template of TEMPLATES) {
        test(`--template ${template} で、ファイルができる`, () => {
            const res = run([`app-${template}`, "--template", template]);
            assert.equal(res.status, 0, res.stderr);
            const dir = join(work, `app-${template}`);
            const files = readdirSync(dir, { recursive: true }).map(String).sort();
            // npm は公開するときに .gitignore を外すので、_gitignore で持っていて、作るときに名前を戻す
            assert.ok(files.includes(".gitignore"), files.join(", "));
            assert.ok(!files.includes("_gitignore"));
            for (const file of files) {
                const path = join(dir, file);
                if (statSync(path).isFile()) {
                    assert.doesNotMatch(readFileSync(path, "utf8"), /\{\{\w+\}\}/, `${file} に置き換えていない所がある`);
                }
            }
            // 次の一歩(起動のコマンドと URL)を出す
            assert.match(res.stdout, template === "workers" ? /localhost:8787/ : /localhost:3927/);
            assert.match(res.stdout, template === "deno" ? /deno task dev/ : /npm run dev/);
        });
    }

    test("package.json の name は、フォルダ名から作る(使えない文字は - に)", () => {
        assert.equal(run(["My App!", "-t", "node"]).status, 0);
        const pkg = JSON.parse(readFileSync(join(work, "My App!", "package.json"), "utf8"));
        assert.equal(pkg.name, "my-app");
    });

    test("--template に知らない値を渡したら、使える値を出してエラー", () => {
        const res = run(["x", "--template", "nope"]);
        assert.equal(res.status, 1);
        for (const template of TEMPLATES) assert.match(res.stderr, new RegExp(template));
        assert.equal(existsSync(join(work, "x")), false);
    });

    test("空でないフォルダには作らない(上書きしない)", () => {
        const dir = join(work, "taken");
        mkdirSync(dir);
        writeFileSync(join(dir, "keep.txt"), "keep");
        const res = run(["taken", "--template", "bun"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /not empty/);
        assert.deepEqual(readdirSync(dir), ["keep.txt"]);
    });

    test("空のフォルダには作れる", () => {
        mkdirSync(join(work, "empty"));
        assert.equal(run(["empty", "--template", "bun"]).status, 0);
        assert.ok(existsSync(join(work, "empty", "package.json")));
    });

    test("端末でないのに答えが足りなければ、聞かずにエラー", () => {
        const res = run(["only-folder"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /--template/);
    });

    test("--help", () => {
        const res = run(["--help"]);
        assert.equal(res.status, 0);
        assert.match(res.stdout, /npm create senri@latest/);
    });

    test("Bun でも動く", { skip: !has("bun") }, () => {
        assert.equal(run(["by-bun", "-t", "bun"], "bun").status, 0);
        assert.ok(existsSync(join(work, "by-bun", "src", "index.ts")));
    });

    test("Deno でも動く", { skip: !has("deno") }, () => {
        const res = run(["by-deno", "-t", "deno"], "deno", ["run", "-A"]);
        assert.equal(res.status, 0, res.stderr);
        assert.ok(existsSync(join(work, "by-deno", "deno.json")));
    });
});

// テンプレートのコードは SENRI_RANGE の範囲の API で書いてある。本体がその外(0.3.0 など)に上がったら、ここで落ちる
// (そのときは、テンプレートを新しい API に直してから、packages/create-senri/version.js の範囲を上げる)
describe("create-senri のテンプレートの @senrijs/senri のバージョン", () => {
    test("範囲が、本体の package.json の version を満たす", () => {
        const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
        assert.ok(satisfiesCaret(SENRI_RANGE, version), `${SENRI_RANGE} は ${version} を満たさない`);
    });

    test("テンプレートは、範囲を埋め込む所を持っている", () => {
        for (const template of TEMPLATES) {
            const file = template === "deno" ? "deno.json" : "package.json";
            assert.match(readFileSync(join(ROOT, "packages/create-senri/templates", template, file), "utf8"), /\{\{senri\}\}/);
        }
    });
});
