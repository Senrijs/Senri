import { createApp } from "../src/index.ts";

const app = createApp();

Bun.serve({
    port: 3000,
    fetch: app.fetch,
})