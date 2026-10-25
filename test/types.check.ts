// 型だけのテスト。bun test では実行せず、bun check(bun run typecheck)で確かめる
// 「ts-expect-error」のコメントは、次の行が型エラーになることを期待する。エラーにならなければ、そちらがエラーになる
import { createApp } from "../src/index.ts";

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
