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
app.get("/created", (_, c) => {
    c.status(201).header("x-senri", "hello");
    return { ok: true };
});
app.get("/accepted", (_, c) => c.json({ hi: 1 }, 202));
app.get("/ua", (_, c) => c.req.headers.get("user-agent") ?? "unknown");

Bun.serve({ port: 3000, fetch: app.fetch });