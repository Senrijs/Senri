// @ts-check
// プロジェクトのフォルダから、ビルドに使う事実を読む(ランタイム・エントリー・ロックファイル・名前)
// 推測したものには、必ず「何を見てそう決めたか」(reason)を付ける。build はそれを画面に出す
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { UsageError } from "../errors.js";

/** @typedef {"bun" | "node" | "deno"} Runtime */
/** @typedef {"npm" | "pnpm" | "bun" | "yarn" | "none"} Lock */

export const RUNTIMES = /** @type {const} */ (["bun", "node", "deno"]);

/**
 * @typedef {object} Project
 * @property {string} dir
 * @property {string} name Kubernetes や Worker の名前に使える形(英小文字・数字・- の 63 文字まで)
 * @property {string | undefined} version package.json / deno.json の version
 * @property {any} pkg package.json(なければ undefined)
 * @property {any} deno deno.json / deno.jsonc(なければ undefined)
 * @property {string | undefined} denoConfig deno.json / deno.jsonc のファイル名
 */

/**
 * JSONC(コメントと末尾のカンマ)を読む。文字列の中の // や /* はそのまま残す
 * @param {string} text
 */
export function parseJsonc(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j;
        } else if (ch === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            out += "\n";
        } else if (ch === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            i = end === -1 ? text.length : end + 1;
        } else {
            out += ch;
        }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * @param {string} path
 * @returns {any}
 */
function readJson(path) {
    try {
        return parseJsonc(readFileSync(path, "utf8"));
    } catch (err) {
        throw new UsageError(`Could not read ${basename(path)}: ${/** @type {Error} */ (err).message}`);
    }
}

/**
 * 名前を、Kubernetes のリソース名・Worker 名・イメージ名に使える形にする(英小文字・数字・- の 63 文字まで)
 * @param {string} raw
 */
export function safeName(raw) {
    const name = raw
        .replace(/^@[^/]+\//, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 63)
        .replace(/-+$/, "");
    return name || "senri-app";
}

/**
 * @param {string} dir
 * @returns {Project}
 */
export function readProject(dir) {
    const pkgPath = join(dir, "package.json");
    const pkg = existsSync(pkgPath) ? readJson(pkgPath) : undefined;
    const denoConfig = ["deno.json", "deno.jsonc"].find((file) => existsSync(join(dir, file)));
    const deno = denoConfig ? readJson(join(dir, denoConfig)) : undefined;
    const rawName = pkg?.name ?? deno?.name ?? basename(dir);
    return {
        dir,
        name: safeName(String(rawName)),
        version: pkg?.version ?? deno?.version,
        pkg,
        deno,
        denoConfig,
    };
}

/**
 * ランタイムを決める。--runtime があればそれ。なければ deno.json → bun.lock → package.json の順に見る
 * @param {Project} project
 * @param {string | undefined} given
 * @returns {{ runtime: Runtime; reason: string }}
 */
export function detectRuntime(project, given) {
    if (given !== undefined) {
        if (!(/** @type {readonly string[]} */ (RUNTIMES).includes(given))) {
            throw new UsageError(`Unknown runtime: ${JSON.stringify(given)}. Use one of: ${RUNTIMES.join(", ")}`);
        }
        return { runtime: /** @type {Runtime} */ (given), reason: "--runtime" };
    }
    if (project.denoConfig) return { runtime: "deno", reason: `found ${project.denoConfig}` };
    for (const file of ["bun.lock", "bun.lockb"]) {
        if (existsSync(join(project.dir, file))) return { runtime: "bun", reason: `found ${file}` };
    }
    // bun install の前は bun.lock がないので、start のコマンドと packageManager も見る
    const start = project.pkg?.scripts?.start;
    if (typeof start === "string") {
        const command = start.trim().split(/\s+/)[0];
        if (command === "bun" || command === "node") return { runtime: command, reason: "scripts.start in package.json" };
    }
    if (typeof project.pkg?.packageManager === "string" && project.pkg.packageManager.startsWith("bun@")) {
        return { runtime: "bun", reason: "packageManager in package.json" };
    }
    if (project.pkg) return { runtime: "node", reason: "found package.json (no bun.lock, no bun in scripts.start)" };
    throw new UsageError(
        `No package.json or deno.json in ${project.dir}. Run senri build in the project folder, or pass --runtime.`,
    );
}

/**
 * ロックファイル(Node.js のときの依存の入れ方を決める)
 * @param {Project} project
 * @returns {{ lock: Lock; file: string | undefined }}
 */
export function detectLock(project) {
    /** @type {[string, Lock][]} */
    const files = [
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"],
        ["pnpm-lock.yaml", "pnpm"],
        ["package-lock.json", "npm"],
        ["yarn.lock", "yarn"],
    ];
    for (const [file, lock] of files) {
        if (existsSync(join(project.dir, file))) return { lock, file };
    }
    return { lock: "none", file: undefined };
}

const SCRIPT_FILE = /^[\w./-]+\.(?:[cm]?[jt]s|tsx|jsx)$/;

/**
 * deno.json の tasks.start(deno run <flags> <file>)を、フラグとファイルに分ける
 * @param {unknown} task
 * @returns {{ flags: string[]; file: string } | undefined}
 */
export function parseDenoTask(task) {
    const command = typeof task === "string" ? task : (/** @type {any} */ (task))?.command;
    if (typeof command !== "string") return undefined;
    const words = command.trim().split(/\s+/);
    if (words[0] !== "deno" || words[1] !== "run") return undefined;
    const flags = [];
    for (const word of words.slice(2)) {
        if (word.startsWith("-")) {
            // --watch は開発のためのもの。本番のイメージには持ち込まない
            if (!word.startsWith("--watch")) flags.push(word);
        } else if (SCRIPT_FILE.test(word)) {
            return { flags, file: word.replace(/^\.\//, "") };
        } else {
            return undefined;
        }
    }
    return undefined;
}

/**
 * エントリー(サーバーを起動するファイル)を決める
 * @param {Project} project
 * @param {Runtime | "workers"} runtime
 * @param {string | undefined} given
 * @returns {{ entry: string; reason: string }}
 */
export function detectEntry(project, runtime, given) {
    if (given !== undefined) {
        const entry = given.replace(/\\/g, "/").replace(/^\.\//, "");
        if (!existsSync(join(project.dir, entry))) throw new UsageError(`--entry ${given} does not exist.`);
        return { entry, reason: "--entry" };
    }
    if (runtime === "deno") {
        const task = parseDenoTask(project.deno?.tasks?.start);
        if (task && existsSync(join(project.dir, task.file))) {
            return { entry: task.file, reason: `tasks.start in ${project.denoConfig}` };
        }
    } else if (runtime !== "workers") {
        const start = project.pkg?.scripts?.start;
        if (typeof start === "string") {
            const file = start.split(/\s+/).find((word) => SCRIPT_FILE.test(word));
            if (file && existsSync(join(project.dir, file))) {
                return { entry: file.replace(/^\.\//, ""), reason: "scripts.start in package.json" };
            }
        }
    }
    for (const file of ["src/index.ts", "src/main.ts", "src/index.js", "index.ts", "main.ts", "index.js"]) {
        if (existsSync(join(project.dir, file))) return { entry: file, reason: "first existing default" };
    }
    throw new UsageError("Could not find the entry file. Pass it with --entry (for example --entry src/index.ts).");
}

/**
 * Docker のイメージに書く Deno の版。このマシンの deno の版に合わせる(イメージには major だけのタグがないため)
 * @returns {{ version: string; reason: string } | undefined}
 */
export function detectDenoVersion() {
    const g = /** @type {{ Deno?: { version: { deno: string } } }} */ (globalThis);
    if (g.Deno) return { version: g.Deno.version.deno, reason: "the running deno" };
    const result = spawnSync("deno", ["--version"], { encoding: "utf8" });
    const match = /deno (\d+\.\d+\.\d+)/.exec(result.stdout ?? "");
    return match?.[1] ? { version: match[1], reason: "deno --version on this machine" } : undefined;
}
