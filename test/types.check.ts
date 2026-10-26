// 型だけのテスト。bun test では実行せず、bun check(bun run typecheck)で確かめる
// 「ts-expect-error」のコメントは、次の行が型エラーになることを期待する。エラーにならなければ、そちらがエラーになる
import { createApp, logger, type Middleware } from "../src/index.ts";

const app = createApp();

// --- ハンドラーの戻り値(項目13) ---

// 関数を返す(呼び忘れ)のは型エラー
// @ts-expect-error
app.get("/fn", () => () => 1);
// async でも同じ
// @ts-expect-error
app.get("/fn-async", async () => () => 1);

// これらは返してよい
app.get("/text", () => "text");
app.get("/json", () => ({ a: 1 }));
app.get("/array", () => [1, 2, 3]);
app.get("/blob", () => new Blob(["x"]));
app.get("/bytes", () => new Uint8Array([1, 2]));
app.get("/stream", () => new ReadableStream());
app.get("/form", () => new FormData());
app.get("/search", () => new URLSearchParams({ q: "x" }));
app.get("/async-json", async () => ({ a: 1 }));

// --- app.routes() のテーブル形式(項目14) ---

app.routes({
    // キーのパスから、パラメーターが推論される
    "GET /u/:id": ({ id }) => id,
    "POST /u/:id/posts/:postId": ({ id, postId }) => `${id} ${postId}`,
    "GET /plain": () => "ok",
});

app.routes({
    // @ts-expect-error パスにないパラメーターは使えない
    "GET /v/:id": ({ nope }) => nope,
});

app.routes({
    // @ts-expect-error メソッドとパスの間にスペースがない
    "GET/hello": () => "x",
});

// --- パスパラメーターの推論(項目15) ---

// 静的セグメントの途中にある ":" はパラメーターではない(実行時と同じ)
app.get("/time/12:00", (p) => {
    // @ts-expect-error "00" というパラメーターはない
    p["00"];
    return "ok";
});

// パスが string 型(リテラルでない)なら、どんな名前でも string として読める
const dynamicPath: string = "/dyn/:id";
app.get(dynamicPath, (p) => {
    const id: string | undefined = p.id;
    return id ?? "none";
});

// 末尾スラッシュがあっても推論できる
app.get("/trailing/:id/", ({ id }) => id);

// --- c.set / c.get(項目19) ---

type User = { name: string };
const typed = createApp<{ user: User; requestId: string }>();

// 汎用のミドルウェア(logger など)はそのまま使える
typed.use(logger());
typed.use((c, next) => {
    c.set("user", { name: "yahari" });
    return next();
});
typed.use((c, next) => {
    // @ts-expect-error 型が違う
    c.set("user", 1);
    return next();
});
typed.use((c, next) => {
    // @ts-expect-error 知らないキー
    c.set("nope", 1);
    return next();
});
typed.get("/me", (_, c) => {
    // 入っていないこともあるので undefined がつく
    const user: User | undefined = c.get("user");
    return user?.name ?? "anonymous";
});

// interface で書いても使える
interface Vars {
    user: User;
}
const withInterface = createApp<Vars>();
withInterface.use(logger());
withInterface.get("/me", (_, c) => c.get("user")?.name ?? "anonymous");

// 外で定義したミドルウェアも使える
const standalone: Middleware = (_c, next) => next();
typed.use(standalone);

// --- ルートのグループ化 ---

import { createRouter } from "../src/index.ts";

const usersRouter = createRouter("/users/:id");
// プレフィックスのパラメーターも推論される
usersRouter.get("/posts/:postId", ({ id, postId }) => `${id}${postId}`);
// @ts-expect-error プレフィックスにもパスにもないパラメーター
usersRouter.get("/", ({ nope }) => nope);
app.route(usersRouter);

// --- app.on / head / options ---

app.on("QUERY", "/q/:id", ({ id }) => id);
app.on(["GET", "POST"], "/multi/:id", ({ id }) => id);
// @ts-expect-error パスにないパラメーター
app.on("PROPFIND", "/dav/:name", ({ nope }) => nope);
app.head("/h/:id", ({ id }) => id);
app.options("/o/:id", ({ id }) => id);
usersRouter.on("QUERY", "/search", ({ id }) => id);
