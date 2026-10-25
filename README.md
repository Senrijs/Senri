# senri

Web 標準の `Request` / `Response` だけで書かれた、小さな Web フレームワークです。Bun / Deno / Node で動きます(Node は `senri/node` のアダプターを使います)。

```ts
import { createApp, logger } from "senri";

const app = createApp();

app.use(logger());
app.get("/hello", () => "こんにちは!");                 // 文字列 → text/plain
app.get("/users/:id", ({ id }) => ({ id }));           // オブジェクト → JSON
app.post("/users", async (_, c) => c.json(await c.req.json(), 201));
```

## 起動のしかた

```ts
// Bun
Bun.serve({ port: 3000, fetch: app.fetch });

// Deno
Deno.serve({ port: 3000 }, app.fetch);

// Node
import { serve } from "senri/node";
serve(app, { port: 3000 });
```

`examples/` に3つのランタイムで同じアプリを動かす例があります。

```bash
bun run dev                                   # Bun(ファイルを保存すると再起動)
deno run --allow-net examples/deno/index.ts   # Deno
node examples/node/index.ts                   # Node
```

## ルート

- `app.get` / `post` / `put` / `patch` / `delete` / `all` で登録します。`all` はどのメソッドでも動きますが、メソッドが合うルートがあればそちらが優先です。
- `app.routes({ "GET /ping": () => "pong" })` のように、表の形でもまとめて登録できます。
- パスパラメーター(`:id`)はハンドラーの第1引数に入ります。型もパスから推論されます。
- 登録順は気にしなくて大丈夫です。`/users/me` は `/users/:id` より優先されます(静的なセグメントが優先)。
- HEAD は GET のルートで処理してボディを捨てます。OPTIONS は 204 と `Allow` ヘッダーを返します。

### ハンドラーの戻り値

| 返すもの | レスポンス |
| --- | --- |
| 文字列 | `text/plain; charset=utf-8` |
| オブジェクト・配列 | JSON |
| `Blob` / `ArrayBuffer` / `Uint8Array` など / `ReadableStream` / `FormData` / `URLSearchParams` | そのままボディ |
| `Response` | そのまま |

関数を返す(呼び忘れ)のは型エラーで、実行時も 500 になります。

## パスのルール

- 末尾スラッシュと連続スラッシュは無視します。`/users`、`/users/`、`//users` はどれも同じパスです。
- パスはセグメント(`/` の間)ごとにパーセントデコードされます。`/こんにちは` のようにそのまま書いたルートにマッチし、パスパラメーターもデコード済みの値で届きます。
- デコードできないパス(`%E0%A4%A` など)と、`%2F`(エンコードされた `/`)を含むパスは 400 になります。
- 正規化・デコード済みのパスは `c.path` で読めます。パスで判定するミドルウェアは `req.url` ではなく `c.path` か `app.use("/admin", mw)` を使ってください。
- 同じメソッド + 同じパス(パラメーター名だけ違うものも含む)を2回登録するとエラーになります。

## ミドルウェア

```ts
app.use(async (c, next) => {
    const res = await next();     // 下流(後ろのミドルウェアとハンドラー)を動かす
    c.header("x-powered-by", "senri");
    return res;
});

// /admin とその下だけで動く
app.use("/admin", (c, next) => {
    if (c.req.headers.get("authorization") !== "secret") {
        c.status(401);
        return "ログインしてね";  // 値を返したら、そこで終わり
    }
    return next();
});
```

- 値を返したら、それがレスポンスになります。何も返さず `next()` 済みなら、下流のレスポンスが使われます。
- `next()` を2回呼ぶとエラーです。
- ルートはミドルウェアより先にマッチするので、`next()` の前から `c.route`(`"/users/:id"` のようなパターン)と `c.params` が読めます。
- `c.header()` で設定したヘッダーは、最後に1回だけレスポンスに足されます。`Response` を直接返したとき、エラーのとき、`next()` のあとに設定したときも効きます。

### ミドルウェアからハンドラーへ値を渡す

```ts
const app = createApp<{ user: { name: string } }>();

app.use((c, next) => {
    c.set("user", { name: "yahari" });
    return next();
});
app.get("/me", (_, c) => c.get("user")?.name ?? "anonymous");
```

## エラー

```ts
import { HttpError } from "senri";

app.get("/secret", () => {
    throw new HttpError(403, "見せられません");   // message はそのままクライアントに返る
});

app.onError((err, c) => ({ error: "something went wrong" }));  // 例外のレスポンスを変える
app.notFound((c) => `ありません: ${c.path}`);                    // 404 のレスポンスを変える
```

## 開発モード

```ts
const app = createApp({ dev: true });
```

開発モードのときだけ、次のものを返します。本番(既定)では `500 Internal Server Error` のような固定の文言だけです。

- 500 の本文に、エラーメッセージ
- 404 に「もしかして: GET /hello ?」
- 405 に、どのメソッドならあるか

ミドルウェアとハンドラーの通過時間も、開発モードのときだけ `c.timings` に記録されます(`self` は `next()` の中の時間を除いたもの)。

環境変数(`NODE_ENV` など)は読みません。ランタイムによって読み方や権限が違うためです。本番では `dev: true` にしないでください。

## logger

```ts
app.use(logger());                     // 色付きで1行ずつ
app.use(logger({ format: "json" }));   // pino 形式の JSON
app.use(logger({ color: false }));     // 色なし
```

色は既定でオンです。ログをファイルや CI に流すときなど、端末でない場所では `color: false` にしてください(ランタイムごとに端末かどうかの判定が違うので、自動では切り替えません)。

## 開発

```bash
bun install
bun test              # テスト(Bun)
bun run test:node     # Node アダプターとパッケージのテスト(Node)
bun run typecheck     # 型チェック(src / test / adapters / examples / Deno)
bun run smoke         # examples を Bun / Deno / Node で起動して確かめる
bun run build         # dist/ に .js と .d.ts を出す
```
