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

`senri/serve` の `serve()` を使うと、Bun / Deno / Node のどれでも同じ書き方で起動できます(ランタイムは自動で判別します)。

```ts
import { serve } from "senri/serve";

const server = await serve(app);   // 起動すると、URL と登録されているルートの一覧を表示する
server.url;                        // 例: "http://localhost:3927"
await server.stop();               // 止める
```

### ポートの決まり方

次の順に、最初に見つかったものを使います。

1. `serve(app, { port: 8080 })` で明示したポート(`0` なら空いているポートを自動で選ぶ)
2. 環境変数 `PORT`(デプロイ先のサービスが決めることが多い)
3. デフォルトの `3927`

- 起動時の表示に、どこから決めたかが出ます(例: `ready  http://localhost:3927  (デフォルト。環境変数 PORT で変えられます)`)
- `PORT` が数字でない、範囲外(0〜65535 以外)などのときは、黙って別のポートで待ち受けずにエラーにします
- Deno では、環境変数を読む許可(`--allow-env=PORT` など)があるときだけ `PORT` を読みます。許可がなければ、許可を求めるプロンプトを出さずにデフォルトを使います

ランタイムの API を直接使うこともできます。

```ts
Bun.serve({ port: 3927, fetch: app.fetch });   // Bun
Deno.serve({ port: 3927 }, app.fetch);          // Deno

import { serve } from "senri/node";             // Node
serve(app, { port: 3927 });
```

`examples/` に3つのランタイムで同じアプリを動かす例があります(開いたら http://localhost:3927 )。

```bash
bun run dev                                    # Bun(ファイルを保存すると再起動)
cd examples/deno && deno task start            # Deno(--allow-env=PORT 付き)
node examples/node/index.ts                    # Node
PORT=8080 node examples/node/index.ts          # ポートを変える
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

ミドルウェアとハンドラーの通過時間も、開発モードのときだけ `c.timings` に記録されます(`self` は `next()` の中の時間を除いたもの、`failed` はその層で例外が起きたか)。

開発モードを決めるのに環境変数(`NODE_ENV` など)は読みません。ランタイムによって読み方や権限が違うためです。本番では `dev: true` にしないでください。

### エラーページと404ページ

開発モードで、ブラウザから開いたとき(`Accept` に `text/html` があるとき)だけ、HTML のページを返します。curl や `fetch` の既定(`*/*`)では、今までどおりテキストです。

- **エラーページ**(5xx): エラーが起きた行の前後のコード、ヒント、スタックトレース(Senri 内部は折りたたみ)、リクエスト、ミドルウェアを通った順番と時間。意図して投げた 4xx の `HttpError` は今までどおりテキストです
- **404ページ**: 「もしかして」(どこが違うかの印付き)と、登録されているルートの一覧(絞り込みつき)
- `app.onError` / `app.notFound` を自分で書いた場合は、そちらが使われます
- ミドルウェアが `next()` のあとで付けたヘッダーや Set-Cookie、作り直したレスポンスのステータスは、そのまま引き継がれます

エラーの場所は、ページ上で選んだエディタで開けます(選択はブラウザに保存されます)。

| エディタ | 開き方 | 自動判別(エディタの中のターミナルから起動したとき) |
| --- | --- | --- |
| VS Code | `vscode://file/…` | `TERM_PROGRAM=vscode` |
| Cursor | `cursor://file/…` | `CURSOR_TRACE_ID` |
| WebStorm(実験的) | `jetbrains://web-storm/…`(JetBrains Toolbox が必要) | `TERMINAL_EMULATOR=JetBrains-JediTerm` |
| Zed | `zed://file/…` | `TERM_PROGRAM=zed` |

分からなければ VS Code になります。該当コードは、プロジェクト(カレントディレクトリ)の中の、利用者のコードだけを読みます(`node_modules` やランタイム内部は読みません)。Deno で `--allow-read` / `--allow-env` がないときは、該当コードやエディタの判別なしでページを出します(許可を求めるプロンプトは出しません)。

ページは `ui/` に Vue + Vite で書かれていて、`bun run build:pages` で1枚の HTML(`src/dev/page.generated.ts`)にして同梱しています。Vue も Vite も、利用者の依存には入りません。見た目を確かめるときは `npx vite --config ui/vite.config.ts` で開けます(`?page=notFound` で404ページ)。

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
bun run build:pages   # ui/ を変えたら、開発用ページ(src/dev/page.generated.ts)を作り直す
```
