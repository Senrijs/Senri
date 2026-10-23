import { createApp } from "../../src/index.ts";

const app = createApp();

app.get("/hello", () => new Response("Hello!"));
app.get("/bye", () => new Response("Bye!"));

Bun.serve({ port: 3000, fetch: app.fetch });