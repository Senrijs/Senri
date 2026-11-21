// @ts-check
// 作ったファイルを書く。既にあるファイルは黙って上書きしない
// - 1 つでもぶつかれば、どれも書かずに止める(途中まで書いた状態を残さない)
// - keepIfExists のもの(.dockerignore など、利用者が既に持っていることが多い設定)は、あればそのまま使う
// - force なら上書きする。そのときも、上書きしたファイルを 1 つずつ出す
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UsageError } from "../errors.js";

/**
 * @typedef {object} GeneratedFile
 * @property {string} path プロジェクトのフォルダからの相対パス(/ 区切り)
 * @property {string} content
 * @property {boolean} [keepIfExists] 既にあれば書かずに、あるものを使う
 */

/**
 * @typedef {object} WritePlan
 * @property {GeneratedFile[]} create
 * @property {GeneratedFile[]} overwrite
 * @property {GeneratedFile[]} keep
 */

/**
 * @param {string} dir
 * @param {GeneratedFile[]} files
 * @param {boolean} force
 * @returns {WritePlan}
 */
export function plan(dir, files, force) {
    /** @type {WritePlan} */
    const result = { create: [], overwrite: [], keep: [] };
    /** @type {GeneratedFile[]} */
    const conflicts = [];
    for (const file of files) {
        if (!existsSync(join(dir, file.path))) result.create.push(file);
        else if (file.keepIfExists && !force) result.keep.push(file);
        else if (force) result.overwrite.push(file);
        else conflicts.push(file);
    }
    if (conflicts.length > 0) {
        const list = conflicts.map((file) => `  ${file.path}`).join("\n");
        throw new UsageError(
            `These files already exist, so nothing was written:\n${list}\n\n` +
                "senri build does not overwrite files. Move or delete them, or pass --force to overwrite them " +
                "(--dry-run shows what would be written).",
        );
    }
    return result;
}

/**
 * @param {string} dir
 * @param {WritePlan} p
 */
export function write(dir, p) {
    for (const file of [...p.create, ...p.overwrite]) {
        const path = join(dir, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content);
    }
}
