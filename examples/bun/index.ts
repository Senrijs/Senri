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

// ログ(何も返さない → 下流のレスポンスを使う)
app.use(async (c, next) => {
    const start = Date.now();
    const res = await next();
    console.log(`${c.req.method} ${new URL(c.req.url).pathname} → ${res.status} (${Date.now() - start}ms)`);
});

// 認証(ダメなら返り値で弾く)
app.use((c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/admin") && c.req.headers.get("authorization") !== "secret") {
        c.status(401);
        return "ログインしてね";
    }
    return next();
});

app.get("/admin", () => "ようこそ管理者さん");

Bun.serve({ port: 3000, fetch: app.fetch });