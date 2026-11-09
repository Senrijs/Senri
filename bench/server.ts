// HTTP ベンチマーク用のサーバー(Bun)。bun server.ts <senri|hono|elysia|raw> <port>
// どのフレームワークも同じ Bun.serve({ fetch }) で動かす(Elysia の listen() や Bun の routes は使わない)
import { APPS } from "./apps.ts";

const [name, port] = process.argv.slice(2);
const make = APPS.find((make) => make().name === name);
if (!make || !port) throw new Error("使い方: bun server.ts <senri|hono|elysia|raw> <port>");

const app = make();
Bun.serve({ port: Number(port), hostname: "127.0.0.1", fetch: app.fetch });
console.log("ready");
