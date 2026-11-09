// HTTP ベンチマーク用のサーバー(Deno)。deno run -A server-deno.ts <senri|hono|elysia|raw> <port>
// どのフレームワークも同じ Deno.serve(fetch) で動かす
import { APPS } from "./apps.ts";

const [name, port] = Deno.args;
const make = APPS.find((make) => make().name === name);
if (!make || !port) throw new Error("使い方: deno run -A server-deno.ts <senri|hono|elysia|raw> <port>");

const app = make();
Deno.serve({ port: Number(port), hostname: "127.0.0.1", onListen: () => console.log("ready") }, app.fetch);
