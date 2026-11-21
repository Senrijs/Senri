#!/usr/bin/env node
// @ts-check
// senri コマンドの入口。コマンドの表(lib/commands.js)を引いて、そのコマンドを動かすだけ
// 依存はなし。Node.js 22 以降・Bun・Deno(deno run -A npm:@senrijs/cli)で動く
// TS ではなく JS で書いているのは、Node が node_modules の中の .ts の型を取り除いてくれないため(create-senri と同じ)
import process from "node:process";
import { main } from "../lib/main.js";

process.exitCode = await main(process.argv.slice(2));
