import { createApp } from "../src/index.ts";

const app = createApp();

Deno.serve({port: 3000}, app.fetch)