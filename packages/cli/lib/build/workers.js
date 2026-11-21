// @ts-check
// --target workers: wrangler の設定(なければ作る)と、wrangler でまとめたバンドル(dist/workers)
// まとめるのも出すのも wrangler に任せる(Cloudflare の公式のやり方。senri が別のやり方を持ち込まない)
// 既にある wrangler の設定は、読むだけで書き換えない
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../errors.js";
import { detectEntry, parseJsonc } from "./project.js";

/** @typedef {import("./project.js").Project} Project */
/** @typedef {import("./write.js").GeneratedFile} GeneratedFile */

export const WRANGLER_CONFIGS = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];
export const WORKERS_OUT = "dist/workers";

/**
 * 既にある wrangler の設定から main を読む
 * @param {string} dir
 * @param {string} file
 * @returns {string | undefined}
 */
function readMain(dir, file) {
    const text = readFileSync(join(dir, file), "utf8");
    if (file.endsWith(".toml")) {
        return /^\s*main\s*=\s*["']([^"']+)["']/m.exec(text)?.[1];
    }
    try {
        const main = parseJsonc(text).main;
        return typeof main === "string" ? main : undefined;
    } catch (err) {
        throw new UsageError(`Could not read ${file}: ${/** @type {Error} */ (err).message}`);
    }
}

/** 今日の日付(UTC)。compatibility_date に使う */
function today() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * @param {Project} project
 * @param {{ entry: string | undefined; header: string }} options
 * @returns {{ files: GeneratedFile[]; notes: string[]; facts: string[]; config: string; entry: string }}
 */
export function workers(project, options) {
    /** @type {GeneratedFile[]} */
    const files = [];
    const notes = [];
    const facts = [];
    const existing = WRANGLER_CONFIGS.find((file) => existsSync(join(project.dir, file)));
    let entry;
    let config;
    if (existing) {
        if (options.entry !== undefined) {
            throw new UsageError(`${existing} already sets the entry (main). Change it there instead of passing --entry.`);
        }
        const main = readMain(project.dir, existing);
        if (!main) throw new UsageError(`${existing} has no main. Add "main": "src/index.ts" (your entry file) to it.`);
        entry = main.replace(/^\.\//, "");
        config = existing;
        facts.push(`Wrangler config: ${existing} (kept as it is)`, `Entry: ${entry} (main in ${existing})`);
    } else {
        const detected = detectEntry(project, "workers", options.entry);
        entry = detected.entry;
        config = "wrangler.jsonc";
        const date = today();
        facts.push(`Wrangler config: wrangler.jsonc (new)`, `Entry: ${entry} (${detected.reason})`);
        files.push({
            path: "wrangler.jsonc",
            content: [
                options.header.replace(/^#/gm, "//"),
                "//",
                "// Assumptions (edit this file if any of them is wrong; senri build will not overwrite it):",
                `// - name: ${project.name}, from the package name (lowercase letters, digits and -, as Cloudflare requires).`,
                `// - main: ${entry}, which must \`export default app\` (Workers calls app.fetch(request, env, ctx)).`,
                `// - compatibility_date: ${date}, the day this file was written (UTC). Change it only on purpose.`,
                '// - No compatibility_flags. contextStorage() from @senrijs/senri/context-storage needs "nodejs_als".',
                "{",
                '  "$schema": "node_modules/wrangler/config-schema.json",',
                `  "name": ${JSON.stringify(project.name)},`,
                `  "main": ${JSON.stringify(entry)},`,
                `  "compatibility_date": ${JSON.stringify(date)}`,
                "}",
                "",
            ].join("\n"),
        });
    }

    const entryPath = join(project.dir, entry);
    if (!existsSync(entryPath)) throw new UsageError(`The entry ${entry} does not exist.`);
    const source = readFileSync(entryPath, "utf8");
    if (!/\bexport\s+default\b/.test(source)) {
        notes.push(`${entry} has no \`export default\`. Workers needs \`export default app\`.`);
    }
    if (/["']@senrijs\/senri\/(?:serve|node)["']/.test(source)) {
        notes.push(`${entry} imports @senrijs/senri/serve or /node, which start a server. Workers does not use them; export the app instead.`);
    }
    return { files, notes, facts, config, entry };
}

/**
 * プロジェクトに入っている wrangler(node_modules/wrangler)の場所
 * @param {string} dir
 * @returns {string | undefined}
 */
export function localWrangler(dir) {
    const path = join(dir, "node_modules", "wrangler", "bin", "wrangler.js");
    return existsSync(path) ? path : undefined;
}

export const WRANGLER_ARGS = ["deploy", "--dry-run", "--outdir", WORKERS_OUT];
