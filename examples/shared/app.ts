import { createApp, health, logger, type StandardSchemaV1 } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { getIp } from "../../src/ip.ts";

// examples は手元で動かすものなので開発モード
export const app = createApp({ dev: devtools() });

// ヘルスチェックはロガーより先に置く(probe のたびにログが出ないように)
app.use(health());
app.use(logger({ format: "json" }));

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
app.post("/echo", async (_, c) => `body=${await c.req.text()}`);
// QUERY: 検索の条件をボディに入れて送る(RFC 10008)
app.on("QUERY", "/search", async (_, c) => ({ query: await c.body() }));
app.get("/client-ip", (_, c) => ({ ip: getIp(c) }));
// バリデーション(Standard Schema)。ふつうは Zod・Valibot・ArkType などのスキーマを渡す。ここでは依存なしで書いた最小のもの
const positive: StandardSchemaV1<unknown, { n: number }> = {
    "~standard": {
        version: 1,
        vendor: "example",
        validate: (value) => {
            const n = Number((value as { n?: unknown }).n);
            return Number.isInteger(n) && n > 0 ? { value: { n } } : { issues: [{ message: "正の整数ではありません", path: ["n"] }] };
        },
    },
};
app.get("/double/:n", { params: positive }, ({ n }) => ({ double: n * 2 }));
app.get("/cookies", (_, c) => {
    c.header("set-cookie", "a=1");
    c.header("set-cookie", "b=2");
    return "ok";
});

// 認証(ダメなら返り値で弾く)。/admin とその下だけで動く
// パスは req.url ではなく、正規化済みの c.path を基準に判定されるので //admin でも素通りできない
app.use("/admin", (c, next) => {
    if (c.req.headers.get("authorization") !== "secret") {
        c.status(401);
        return "ログインしてね";
    }
    return next();
});

app.get("/admin", () => "ようこそ管理者さん");

app.get("/boom", () => {
    throw new Error("わざと壊した");
});
