// @ts-check
// コマンドを振り分ける。コマンドを足すときは COMMANDS に 1 行と、lib/<name>.js を足す
// (senri dev(#149)・senri replay(#150)も、ここにぶら下げる)
// 表に載っていないコマンドは、まだないものとして扱う(help にも出さない。ないものを出すと嘘になる)
import { readFileSync } from "node:fs";
import { UsageError } from "./errors.js";

/**
 * @typedef {{ summary: string; load: () => Promise<{ run(args: string[]): Promise<void> }> }} Command
 */

/** @type {Record<string, Command>} */
const COMMANDS = {
    build: {
        summary: "Write deployment files for Cloudflare Workers, Docker or Kubernetes",
        load: () => import("./build/index.js"),
    },
};

/** @returns {string} */
export function version() {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version;
}

function help() {
    const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
    const list = Object.entries(COMMANDS)
        .map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`)
        .join("\n");
    return `senri ${version()}

Usage:
  senri <command> [options]

Commands:
${list}

Options:
  -h, --help     Show help (also: senri <command> --help)
  -v, --version  Show the version
`;
}

/**
 * @param {string[]} args コマンド名から後ろの引数
 * @returns {Promise<number>} 終了コード
 */
export async function main(args) {
    const [name, ...rest] = args;
    try {
        if (name === undefined || name === "-h" || name === "--help" || name === "help") {
            console.log(help());
            return 0;
        }
        if (name === "-v" || name === "--version") {
            console.log(version());
            return 0;
        }
        const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
        if (!command) throw new UsageError(`Unknown command: ${JSON.stringify(name)}\n\n${help()}`);
        await (await command.load()).run(rest);
        return 0;
    } catch (err) {
        if (err instanceof UsageError) {
            console.error(`error: ${err.message}`);
        } else {
            console.error(err);
        }
        return 1;
    }
}
