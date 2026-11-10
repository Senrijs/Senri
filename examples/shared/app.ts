import { compress, createApp, health, logger, type StandardSchemaV1 } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { getSignedCookie, setSignedCookie } from "../../src/cookie.ts";
import { getIp } from "../../src/ip.ts";
import { multipart } from "../../src/multipart.ts";

// examples は手元で動かすものなので開発モード
export const app = createApp({ dev: devtools() });

// ヘルスチェックはロガーより先に置く(probe のたびにログが出ないように)
app.use(health());
app.use(logger({ format: "json" }));

app.use("/compressed", compress());
app.get("/compressed", () => "こんにちは!".repeat(100));

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
// 大きいファイルを、メモリにためずに受け取る。保存はせず、パーツごとの大きさと全バイトの合計を返す
app.post("/upload", async (_, c) => {
    const parts: { name: string; filename?: string; size: number; sum: number }[] = [];
    for await (const part of multipart(c, { maxFileSize: 64 * 1024 * 1024 })) {
        let size = 0;
        let sum = 0;
        const reader = part.stream.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            for (const byte of value) sum += byte;
        }
        parts.push({ name: part.name, filename: part.filename, size, sum });
    }
    return parts;
});
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
// 署名付き Cookie: 送られてきたものを確かめて返し、新しく署名したものを付ける
// (秘密鍵は、本物のアプリではコードに書かず、環境変数や c.env から読む)
app.get("/signed", async (_, c) => {
    const user = await getSignedCookie(c, "user", "example-secret");
    await setSignedCookie(c, "user", "42", "example-secret");
    return String(user);
});
app.get("/page", (_, c) => c.html("<h1>こんにちは!</h1>"));
// ログインしたら Cookie を付けて、別のページへ
app.get("/login", (_, c) => {
    c.header("set-cookie", "session=1");
    c.header("set-cookie", "seen=1");
    return c.redirect("/hello", 303);
});
// ASCII 以外のリダイレクト先は、どのランタイムでも同じ形にエンコードされる
app.get("/to/japanese", (_, c) => c.redirect("/users/山田"));
app.get("/to/idn", (_, c) => c.redirect("https://例え.jp/パス"));
app.get("/to/surrogate", (_, c) => c.redirect("/\ud800"));
// /assets とその下のすべてに当たる。残りのパスは "*" で受け取る
app.get("/assets/*", ({ "*": rest }) => `assets: ${rest}`);
// ルートはあるけれど、中身が見つからないとき
app.get("/items/:id", (_, c) => {
    c.header("set-cookie", "seen=1");
    return c.notFound();
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

// "/members/*" は "/members" と同じ意味(/members とその下で動く)
app.use("/members/*", (c, next) => {
    if (c.req.headers.get("authorization") !== "secret") {
        c.status(401);
        return "ログインしてね";
    }
    return next();
});

app.get("/members/page", () => "会員のページ");

app.get("/boom", () => {
    throw new Error("わざと壊した");
});
