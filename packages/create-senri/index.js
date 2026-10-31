#!/usr/bin/env node
// @ts-check
// npm create senri / bun create senri / pnpm create senri で、Senri のアプリの雛形を作る
// 依存はなし(質問は node:readline/promises)。Node.js 22 以降・Bun・Deno(deno run -A npm:create-senri)で動く
// TS ではなく JS で書いているのは、Node が node_modules の中の .ts の型を取り除いてくれないため(npx で動かせない)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SENRI_RANGE } from "./version.js";

/** @typedef {"bun" | "node" | "deno" | "workers"} Template */

// 質問に出す順。port は、作ったアプリを dev で動かしたときのポート(Workers は wrangler dev の既定)
/** @type {Record<Template, { label: string; port: number }>} */
const TEMPLATES = {
    bun: { label: "Bun", port: 3927 },
    node: { label: "Node.js", port: 3927 },
    deno: { label: "Deno", port: 3927 },
    workers: { label: "Cloudflare Workers", port: 8787 },
};
const NAMES = /** @type {Template[]} */ (Object.keys(TEMPLATES));
const TEMPLATE_DIR = fileURLToPath(new URL("./templates/", import.meta.url));
const DEFAULT_FOLDER = "senri-app";

const HELP = `Create a new Senri app.

Usage:
  npm create senri@latest [folder] [-- --template <name>]
  bun create senri [folder] [--template <name>]
  pnpm create senri [folder] [--template <name>]

Options:
  -t, --template <name>  ${NAMES.join(" | ")}
  -h, --help             Show this help
`;

// 使い方の間違い。メッセージだけ出して、終了コード 1 で終わる
class UsageError extends Error {}

/** @param {string} value */
function isTemplate(value) {
    return /** @type {string[]} */ (NAMES).includes(value);
}

// 作ったアプリを動かすコマンド(create を動かしたパッケージマネージャーに合わせる)
function packageManager() {
    const agent = process.env.npm_config_user_agent ?? "";
    for (const pm of ["pnpm", "yarn", "bun", "npm"]) {
        if (agent.startsWith(`${pm}/`)) return pm;
    }
    return "Bun" in globalThis ? "bun" : "npm";
}

// 質問のときの既定のランタイム(create を動かしているランタイム)
/** @returns {Template} */
function defaultTemplate() {
    if ("Deno" in globalThis) return "deno";
    if ("Bun" in globalThis || (process.env.npm_config_user_agent ?? "").startsWith("bun/")) return "bun";
    return "node";
}

// フォルダ名から、package.json の name に使える名前を作る
/** @param {string} dir */
function packageName(dir) {
    const name = basename(dir)
        .toLowerCase()
        .replace(/[^a-z0-9._~-]+/g, "-")
        .replace(/^[._-]+|-+$/g, "");
    return name || DEFAULT_FOLDER;
}

// ないか、空のフォルダなら true。中身があれば、上書きしないように false
/** @param {string} dir */
function canCreateIn(dir) {
    let stat;
    try {
        stat = statSync(dir);
    } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return true;
        throw err;
    }
    return stat.isDirectory() && readdirSync(dir).length === 0;
}

// テンプレートを写す。_gitignore は .gitignore にする(npm は公開するときに .gitignore を外すので、別の名前で持っている)
/**
 * @param {string} from
 * @param {string} to
 * @param {Record<string, string>} vars {{name}} のように書いた所を置き換える値
 */
function copyTemplate(from, to, vars) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        const source = join(from, entry.name);
        const target = join(to, entry.name === "_gitignore" ? ".gitignore" : entry.name);
        if (entry.isDirectory()) {
            copyTemplate(source, target, vars);
        } else {
            const text = readFileSync(source, "utf8").replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
            writeFileSync(target, text);
        }
    }
}

/**
 * @param {Template} template
 * @param {string} dir 作ったフォルダ
 */
function nextSteps(template, dir) {
    const steps = [];
    const rel = relative(process.cwd(), dir);
    if (rel !== "") steps.push(`cd ${/\s/.test(rel) ? JSON.stringify(rel) : rel}`);
    if (template === "deno") {
        steps.push("deno task dev");
    } else {
        const pm = packageManager();
        steps.push(`${pm} install`);
        steps.push(pm === "npm" || pm === "bun" ? `${pm} run dev` : `${pm} dev`);
    }
    const last = steps.length - 1;
    steps[last] = `${steps[last]}   # → http://localhost:${TEMPLATES[template].port}`;
    return steps.map((s) => `  ${s}`).join("\n");
}

/**
 * 足りない答えを聞く。端末でなければ聞けないので、エラーにする(CI で止まったままにならないように)
 * @param {string | undefined} folder
 * @param {Template | undefined} template
 * @returns {Promise<{ folder: string; template: Template }>}
 */
async function ask(folder, template) {
    if (folder !== undefined && template !== undefined) return { folder, template };
    if (!process.stdin.isTTY) {
        throw new UsageError(`Pass the folder name and --template (${NAMES.join(" | ")}) when not running in a terminal.`);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        if (folder === undefined) {
            folder = (await rl.question(`Project folder (${DEFAULT_FOLDER}): `)).trim() || DEFAULT_FOLDER;
        }
        while (template === undefined) {
            const fallback = defaultTemplate();
            const list = NAMES.map((name, i) => `  ${i + 1}) ${TEMPLATES[name].label}`).join("\n");
            const answer = (await rl.question(`Runtime:\n${list}\nChoose 1-${NAMES.length} (${TEMPLATES[fallback].label}): `)).trim().toLowerCase();
            if (answer === "") template = fallback;
            else if (isTemplate(answer)) template = /** @type {Template} */ (answer);
            else if (/^\d+$/.test(answer) && NAMES[Number(answer) - 1]) template = NAMES[Number(answer) - 1];
            else console.log(`Please choose 1-${NAMES.length}.`);
        }
        return { folder, template };
    } finally {
        rl.close();
    }
}

async function main() {
    let parsed;
    try {
        parsed = parseArgs({
            args: process.argv.slice(2),
            allowPositionals: true,
            options: {
                template: { type: "string", short: "t" },
                help: { type: "boolean", short: "h" },
            },
        });
    } catch (err) {
        throw new UsageError(`${/** @type {Error} */ (err).message}\n\n${HELP}`);
    }
    if (parsed.values.help) {
        console.log(HELP);
        return;
    }
    if (parsed.positionals.length > 1) throw new UsageError(`Too many arguments: ${parsed.positionals.join(" ")}\n\n${HELP}`);

    const given = parsed.values.template;
    if (given !== undefined && !isTemplate(given)) {
        throw new UsageError(`Unknown template: ${JSON.stringify(given)}. Use one of: ${NAMES.join(", ")}`);
    }
    // 先にフォルダを確かめる(質問に答えてから断られないように、フォルダ名が渡されていればここで止める)
    const folderArg = parsed.positionals[0];
    if (folderArg !== undefined && !canCreateIn(resolve(folderArg))) {
        throw new UsageError(`${folderArg} is not empty. Choose another folder, or empty it first.`);
    }
    const { folder, template } = await ask(folderArg, /** @type {Template | undefined} */ (given));
    const dir = resolve(folder);
    if (!canCreateIn(dir)) throw new UsageError(`${folder} is not empty. Choose another folder, or empty it first.`);

    copyTemplate(join(TEMPLATE_DIR, template), dir, { name: packageName(dir), senri: SENRI_RANGE });
    console.log(`\nCreated a Senri app (${TEMPLATES[template].label}) in ${dir}\n\nNext steps:\n${nextSteps(template, dir)}\n`);
}

main().catch((err) => {
    if (err instanceof UsageError) {
        console.error(`error: ${err.message}`);
    } else {
        console.error(err);
    }
    process.exitCode = 1;
});
