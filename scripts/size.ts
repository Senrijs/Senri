// app.get("/", () => "hi") だけのアプリをバンドルして、サイズを測る
// 使い方: bun scripts/size.ts [入口のファイル(既定は src/index.ts)]
// - bun build --target browser(1ファイル / --splitting あり)
// - Vite(ライブラリモードではなく、ふつうのアプリとしてビルド)
// - wrangler deploy --dry-run --outdir(Cloudflare Workers。デプロイはしない)
// それぞれ minify なし・あり、gzip 後を出す。ファイルが分かれたときは「最初に読むもの」と「全部」を分けて出す
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");

// このスクリプトは Bun で動かす(scripts/ は Node の型で検査するので、使う部分だけ型を書く)
declare const Bun: {
    build(options: { entrypoints: string[]; target: string; minify: boolean; splitting: boolean; outdir: string }): Promise<{
        success: boolean;
        logs: unknown[];
    }>;
};
const entry = resolve(ROOT, process.argv[2] ?? "src/index.ts").replaceAll("\\", "/");
const WRANGLER = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.exe" : "wrangler");

const APP = `import { createApp } from "${entry}";
const app = createApp();
app.get("/", () => "hi");
`;

type Size = { raw: number; gzip: number };
type Row = { tool: string; minify: boolean; first: Size; total: Size; files: number };

async function jsFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const name of await readdir(dir, { recursive: true })) {
        const path = join(dir, String(name));
        if (String(name).endsWith(".js") && (await stat(path)).isFile()) out.push(path);
    }
    return out;
}

async function sizeOf(files: string[]): Promise<Size> {
    let raw = 0;
    let gzip = 0;
    for (const file of files) {
        const data = await readFile(file);
        raw += data.byteLength;
        gzip += gzipSync(data, { level: 9 }).byteLength;
    }
    return { raw, gzip };
}

async function bun(dir: string, minify: boolean, splitting: boolean): Promise<Row> {
    await writeFile(join(dir, "main.ts"), `${APP}export default app;\n`);
    const outdir = join(dir, "out");
    const result = await Bun.build({ entrypoints: [join(dir, "main.ts")], target: "browser", minify, splitting, outdir });
    if (!result.success) throw new Error(result.logs.join("\n"));
    const files = await jsFiles(outdir);
    return {
        tool: splitting ? "bun build --splitting" : "bun build",
        minify,
        first: await sizeOf(files.filter((f) => f.endsWith("main.js"))),
        total: await sizeOf(files),
        files: files.length,
    };
}

async function vite(dir: string, minify: boolean): Promise<Row> {
    // ふつうのアプリとして: index.html から main.ts を読む。app はページのどこかで使う想定で、globalThis に置く
    await writeFile(join(dir, "index.html"), `<!doctype html><script type="module" src="./main.ts"></script>\n`);
    await writeFile(join(dir, "main.ts"), `${APP}(globalThis as any).app = app;\n`);
    const { build } = await import("vite");
    await build({ root: dir, logLevel: "silent", configFile: false, build: { minify, outDir: "out", emptyOutDir: true } });
    const files = await jsFiles(join(dir, "out"));
    const html = await readFile(join(dir, "out", "index.html"), "utf8");
    // index.html が直接読むものが「最初に読むもの」
    const first = files.filter((f) => html.includes(f.split(/[\\/]/).pop()!));
    return { tool: "Vite", minify, first: await sizeOf(first), total: await sizeOf(files), files: files.length };
}

async function wrangler(dir: string, minify: boolean): Promise<Row> {
    await writeFile(join(dir, "index.ts"), `${APP}export default app;\n`);
    await writeFile(join(dir, "wrangler.toml"), `name = "size"\nmain = "index.ts"\ncompatibility_date = "2026-10-01"\n`);
    const args = ["deploy", "--dry-run", "--outdir", "out", ...(minify ? ["--minify"] : [])];
    const run = spawnSync(WRANGLER, args, { cwd: dir, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    if (run.status !== 0) throw new Error(`wrangler が失敗しました\n${run.stdout}\n${run.stderr}`);
    const files = await jsFiles(join(dir, "out"));
    return {
        tool: "wrangler --dry-run",
        minify,
        first: await sizeOf(files.filter((f) => f.endsWith("index.js"))),
        total: await sizeOf(files),
        files: files.length,
    };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

const rows: Row[] = [];
for (const minify of [false, true]) {
    for (const measure of [
        (d: string) => bun(d, minify, false),
        (d: string) => bun(d, minify, true),
        (d: string) => vite(d, minify),
        (d: string) => wrangler(d, minify),
    ]) {
        const dir = await mkdtemp(join(tmpdir(), "senri-size-"));
        try {
            await mkdir(dir, { recursive: true });
            rows.push(await measure(dir));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
}

console.log(`入口: ${entry.slice(ROOT.length + 1)}\n`);
console.log("| ツール | minify | 最初に読むもの | gzip | 全部 | gzip | ファイル数 |");
console.log("|---|---|---:|---:|---:|---:|---:|");
for (const r of rows) {
    console.log(
        `| ${r.tool} | ${r.minify ? "あり" : "なし"} | ${kb(r.first.raw)} | ${kb(r.first.gzip)} | ${kb(r.total.raw)} | ${kb(r.total.gzip)} | ${r.files} |`,
    );
}
