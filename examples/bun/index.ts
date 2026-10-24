import { createApp } from "../../src/index.ts";

const app = createApp();

app.get("/hello", () => "こんにちは!");
app.get("/user", () => ({ name: "yahari" }));
app.get("/raw", () => new Response("raw"));
app.get("/users/:id", ({ id }) => `user ${id}`);
app.get("/users/:id/posts/:postId", ({ id, postId }) => `${id} の投稿 ${postId}`);
app.get("/users/me", () => "それは自分です");
app.delete("/users/:id", ({ id }) => `user ${id} を削除しました`);
app.routes({
  "GET /ping": () => "pong",
  "POST /users": () => ({ ok: true }),
});

Bun.serve({ port: 3000, fetch: app.fetch });