// 使わないものがバンドルに入らないことを確かめるための、テスト用の部品
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../src").replaceAll("\\", "/");

// Context にしかないエラーのコード。これが入っていれば、Context がバンドルに入っている
export const CONTEXT_MARKER = "no_execution_ctx";

// src/index.ts から name だけを読み込んだバンドル(minify 済み)
export async function bundleOf(name: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "senri-bundle-"));
    try {
        writeFileSync(join(dir, "main.ts"), `export { ${name} } from "${SRC}/index.ts";\n`);
        const result = await Bun.build({ entrypoints: [join(dir, "main.ts")], target: "browser", minify: true, outdir: join(dir, "out") });
        if (!result.success) throw new Error(String(result.logs));
        return readFileSync(join(dir, "out", "main.js"), "utf8");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
