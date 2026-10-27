// 本番(dev: false)では、開発用のモジュール(src/dev/ のエラーページ・ダッシュボードなど)を一度も読み込まないこと
// 読み込まれたモジュールは module.registerHooks で記録する(子プロセスで動かすので、ほかのテストと混ざらない)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

function loadedModules(mode: "dev" | "prod", from: "src" | "dist"): string[] {
    const run = spawnSync(process.execPath, ["--import", "./record-modules.ts", "use-app.ts", mode, from], {
        cwd: fixtures,
        encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const line = run.stdout.split("\n").find((l) => l.startsWith("__MODULES__"));
    assert.ok(line, "読み込まれたモジュールの記録がない");
    return JSON.parse(line.slice("__MODULES__".length)) as string[];
}

// src/dev/ と dist/src/dev/ のどちらでも
const isDev = (url: string) => /\/src\/dev\//.test(url);

describe("開発用のモジュールの切り離し", () => {
    for (const from of ["src", "dist"] as const) {
        test(`本番では、src/dev/ のモジュールを1つも読み込まない(${from})`, () => {
            const loaded = loadedModules("prod", from);
            assert.ok(loaded.some((url) => /\/src\/(index|app)\.(ts|js)$/.test(url)), "アプリのモジュールが記録されていない");
            assert.deepEqual(loaded.filter(isDev), []);
            // node:fs も読まない(開発モードでソースを読むためだけに使う)
            assert.deepEqual(loaded.filter((url) => url.startsWith("node:fs")), []);
        });
    }

    test("開発モードでは読み込む(記録のしかたが正しいことの確認)", () => {
        const loaded = loadedModules("dev", "src");
        assert.ok(loaded.some((url) => url.endsWith("/src/dev/index.ts")));
    });
});
