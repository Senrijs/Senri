// 子プロセスで動かす: node --import ./record-modules.ts <アプリのスクリプト>
// 読み込まれたモジュールの URL を全部記録して、終わるときに標準出力へ JSON で出す
// (module.registerHooks は Node 22.15 / 23.5 から。CI の Node 24 で使える)
import { registerHooks } from "node:module";

const loaded: string[] = [];

registerHooks({
    load(url, context, nextLoad) {
        loaded.push(url);
        return nextLoad(url, context);
    },
});

process.on("exit", () => {
    process.stdout.write(`\n__MODULES__${JSON.stringify(loaded)}\n`);
});
