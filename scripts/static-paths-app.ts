// scripts/static-paths.ts が起動するアプリ。使い方: <bun | deno run --allow-net --allow-read | node> scripts/static-paths-app.ts <root> <port>
import process from "node:process";
import { createApp } from "../src/index.ts";
import { serve } from "../adapters/serve/index.ts";
import { serveStatic } from "../adapters/static/index.ts";

const [root, port] = process.argv.slice(2);
const app = createApp();
// root の一部を守るミドルウェア(綴りを変えて飛ばせないかを確かめる)
app.use("/admin", () => new Response("auth", { status: 401 }));
app.use(serveStatic({ root: root! }));
await serve(app, { port: Number(port), hostname: "127.0.0.1" });
