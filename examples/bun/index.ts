import { createApp } from "../../src/index.ts";

const app = createApp();

app.get("/hello", () => "こんにちは!");
app.get("/user", () => ({ name: "yahari" }));
app.get("/raw", () => new Response("raw"));

Bun.serve({ port: 3000, fetch: app.fetch });