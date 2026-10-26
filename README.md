<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Senrijs/Senri/main/.github/assets/senri-wordmark-dark.svg">
    <img src="https://raw.githubusercontent.com/Senrijs/Senri/main/.github/assets/senri-wordmark-light.svg" alt="Senri" width="320">
  </picture>
</p>

<p align="center">
  Web 標準の <code>Request</code> / <code>Response</code> だけで書かれた、小さな Web フレームワーク。<br>
  Bun・Deno・Node.js・Cloudflare Workers で、同じコードが動きます。
</p>

```ts
import { createApp } from "@senrijs/senri";
import { serve } from "@senrijs/senri/serve";

const app = createApp();

app.get("/hello", () => "こんにちは!");          // 文字列 → text/plain
app.get("/users/:id", ({ id }) => ({ id }));    // オブジェクト → JSON(id の型はパスから推論)

serve(app);   // Bun でも Deno でも Node.js でも
```

- **返した値がレスポンスになる。** 文字列はテキスト、オブジェクトは JSON。`Response` もそのまま返せます
- **型はパスから。** `/users/:id` と書けば、ハンドラーの `id` に型が付きます。[Standard Schema](https://standardschema.dev)(Zod・Valibot・ArkType など)で、パラメーター・クエリ・ボディも確かめられます
- **開発モードが親切。** エラーページ(該当コード・ヒント・エディタで開く)、404 の「もしかして」、リクエストを玉ねぎのように見られるダッシュボード(`/_senri`)、層ごとの `Server-Timing`
- **どこでも動く。** Web 標準の API だけで書いていて、`eval` も `new Function` も使いません

## インストール

```bash
npm install @senrijs/senri   # Node.js / Bun
bun add @senrijs/senri
deno add jsr:@senrijs/senri
```

Node.js は 22 以降で動きます。

## 起動のしかた

`@senrijs/senri/serve` の `serve()` は、ランタイムを自動で判別して起動します。

```ts
import { serve } from "@senrijs/senri/serve";

const server = await serve(app);   // 起動すると、URL と登録されているルートの一覧を表示する
server.url;                        // 例: "http://localhost:3927"
await server.stop();               // 処理中のリクエストを待ってから止める
```

ポートは次の順に、最初に見つかったものを使います。

1. `serve(app, { port: 8080 })` で明示したポート(`0` なら空いているポートを自動で選ぶ)
2. 環境変数 `PORT`(数字でない、範囲外などのときは、黙って別のポートで待ち受けずにエラーにします)
3. デフォルトの `3927`

Deno では、環境変数を読む許可(`--allow-env=PORT` など)があるときだけ `PORT` を読みます。許可がなければ、プロンプトを出さずにデフォルトを使います。

ランタイムの API を直接使うこともできます。

```ts
Bun.serve({ port: 3927, fetch: app.fetch });   // Bun
Deno.serve({ port: 3927 }, app.fetch);          // Deno

import { serve } from "@senrijs/senri/node";             // Node.js
serve(app, { port: 3927 });
```

### Cloudflare Workers

アプリをそのまま `export default` します。`c.env` と `c.executionCtx` が使えます。

```ts
import { createApp } from "@senrijs/senri";

type Env = { GREETING: string };
const app = createApp<{ Bindings: Env }>();

app.get("/", (_, c) => {
    c.executionCtx.waitUntil(logSomewhere());
    return c.env.GREETING;   // string
});

export default app;
```

- 変数の型も決めるときは `createApp<{ Bindings: Env; Variables: { user: User } }>()` と書きます。変数だけなら、今までどおり `createApp<{ user: User }>()` です
- `c.ip` は、Cloudflare が付ける `CF-Connecting-IP` を読みます(Workers で動いているときだけ)
- 開発モードのダッシュボードは作りません(`/_senri` はふつうの 404)。エラーページは出ますが、該当コードは出ません
- 静的ファイルは `@senrijs/senri/static` ではなく、Workers の [Static Assets](https://developers.cloudflare.com/workers/static-assets/) で配ってください

### 止め方(graceful shutdown)

`serve()` は SIGTERM / SIGINT を受けると、次の順に止まります。

1. `health()` の `/readyz` を 503 にする(ロードバランサーが新しいリクエストを送ってこないように)
2. 新しい接続を受けるのをやめ、処理中のリクエストが終わるのを待つ(`shutdownTimeout`、既定 10 秒。過ぎたら残りの接続を切る)
3. `onShutdown` を呼んでから終わる。待っている間にもう一度シグナルを受けたら、すぐに終わる

```ts
serve(app, {
    shutdownTimeout: 30_000,
    onShutdown: () => db.close(),
});
```

ランタイムの既定どおりにしたいときは `gracefulShutdown: false` にします。

## ルート

```ts
app.get("/users/me", () => "それは自分です");     // 静的なセグメントが優先(登録順は関係ない)
app.get("/users/:id", ({ id }) => `user ${id}`);
app.post("/users", async (_, c) => c.json(await c.body(), 201));
app.on(["PUT", "PATCH"], "/users/:id", () => "updated");
app.all("/any", () => "どのメソッドでも");
app.routes({ "GET /ping": () => "pong" });        // 表の形でもまとめて登録できる
```

- `app.get` / `post` / `put` / `patch` / `delete` / `head` / `options` / `all`、任意のメソッドは `app.on(method | method[], path, handler)`
- HEAD は、登録していなければ GET のルートで処理してボディを捨てます。OPTIONS は、登録していなければ 204 と `Allow` を返します
- `QUERY` メソッド([RFC 10008](https://www.rfc-editor.org/rfc/rfc10008.html))は `app.on("QUERY", path, handler)` で登録します。ボディがなければ 400、Content-Type がなければ 415 にします
- CONNECT / TRACE / TRACK は扱いません(501)
- 同じメソッド + 同じパス(パラメーター名だけ違うものも含む)を2回登録するとエラーになります

### ハンドラーの戻り値

| 返すもの | レスポンス |
| --- | --- |
| 文字列 | `text/plain; charset=utf-8` |
| オブジェクト・配列 | JSON |
| `Blob` / `ArrayBuffer` / `Uint8Array` など / `ReadableStream` / `FormData` / `URLSearchParams` | そのままボディ |
| `Response` | そのまま |

関数を返す(呼び忘れ)のは型エラーで、実行時も 500 になります。

### グループ化

```ts
import { createRouter } from "@senrijs/senri";

const posts = createRouter("/users/:id/posts");
posts.get("/", ({ id }) => `user ${id} の投稿`);          // id に型が付く
posts.get("/:postId", ({ id, postId }) => `${id} / ${postId}`);
app.route(posts);

app.route("/admin", adminApp);                             // 別の createApp() をつなぐこともできる
```

### パスのルール

- 末尾スラッシュと連続スラッシュは無視します。`/users`、`/users/`、`//users` はどれも同じです
- パスはセグメントごとにパーセントデコードされます。`/こんにちは` のようにそのまま書いたルートにマッチします
- デコードできないパスと、`%2F`(エンコードされた `/`)を含むパスは 400 です
- 正規化・デコード済みのパスは `c.path` で読めます。パスで判定するミドルウェアは、`req.url` ではなく `c.path` か `app.use("/admin", mw)` を使ってください

## リクエストを読む

```ts
app.post("/search", async (_, c) => {
    c.query("page");          // "2"(なければ undefined。c.query() で全部)
    c.queries("tag");         // ["a", "b"]
    await c.body();           // Content-Type に合わせて読む(JSON・フォーム・テキスト・それ以外は ArrayBuffer)
    c.cookie("session");      // Cookie
    c.ip;                     // 接続元の IP アドレス(分からなければ null)
    return "ok";
});
```

- `c.body()` は何度呼んでも同じ結果です(ミドルウェアとハンドラーの両方から読めます)
- `c.ip` はランタイムが渡す接続元を使います。`X-Forwarded-For` などのヘッダーは偽装できるので読みません。プロキシの後ろでは、プロキシが付けるヘッダーを自分で読んでください
- `c.setCookie(name, value, options)` の既定は `Path=/`・`HttpOnly`・`SameSite=Lax` です

## バリデーション

ルートにスキーマを渡すと、ハンドラーを呼ぶ前に確かめます。[Standard Schema](https://standardschema.dev) に対応したライブラリ(Zod・Valibot・ArkType など)のスキーマが、そのまま使えます。

```ts
import { z } from "zod";

app.post(
    "/users/:id",
    {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({ name: z.string().min(1) }),
    },
    ({ id }, c) => {
        const { name } = c.valid("body");   // { name: string }
        return { id, name };                // id: number
    },
);
```

- `params`・`query`・`body` を渡せます。`params` が通れば、ハンドラーの第1引数が変換後の値になります
- 通らなければ 400 です。本番の本文は `400 Bad Request` だけで、開発モードでは、どこが違うかを一覧にします
- 自分の形で返したいときは、`app.onError` で `ValidationError` を受けます(`err.target` と `err.issues`)

## ミドルウェア

```ts
app.use(async (c, next) => {
    const res = await next();       // 下流(後ろのミドルウェアとハンドラー)を動かす
    c.header("x-powered-by", "senri");
    return res;
});

// /admin とその下だけで動く
app.use("/admin", (c, next) => {
    if (c.req.headers.get("authorization") !== "secret") {
        c.status(401);
        return "ログインしてね";      // 値を返したら、そこで終わり
    }
    return next();
});
```

- ルートはミドルウェアより先にマッチするので、`next()` の前から `c.route`(`"/users/:id"` のようなパターン)と `c.params` が読めます
- `c.header()` で設定したヘッダーは、最後に1回だけレスポンスに足されます。`Response` を直接返したときも、エラーのときも効きます
- ミドルウェアからハンドラーへ値を渡すには `c.set` / `c.get` を使います。型は `createApp<{ user: User }>()` で決めます

### 標準のミドルウェア

```ts
import { bodyLimit, cors, health, logger, secureHeaders } from "@senrijs/senri";
import { serveStatic } from "@senrijs/senri/static";

app.use(health({ ready: () => db.isConnected() }));   // /healthz と /readyz
app.use(logger());                                     // 色付きで1行ずつ。{ format: "json" } で pino 形式
app.use(secureHeaders());                              // X-Content-Type-Options など
app.use(cors({ origin: ["https://example.com"] }));
app.use(bodyLimit({ maxSize: 1024 * 1024 }));          // 超えたら 413
app.use(serveStatic({ root: "./public" }));            // Bun・Deno・Node.js で静的ファイルを配る
```

- `health()`: `/healthz` は応答できれば 200。`/readyz` は `ready()` が true なら 200、false・例外・止まり始めたあとは 503
- `logger()`: 色は既定でオンです。ファイルや CI に流すときは `color: false` にしてください
- `secureHeaders()`: Content-Security-Policy と Cross-Origin-Embedder-Policy は既定でオフです(アプリによって壊れやすいので)
- `serveStatic()`: ドットファイルは既定で配りません。root の外(シンボリックリンクを含む)には出ません

## エラー

```ts
import { HttpError } from "@senrijs/senri";

app.get("/secret", () => {
    throw new HttpError(403, "見せられません");      // message はそのままクライアントに返る
});

app.onError((err, c) => ({ error: "something went wrong" }));
app.notFound((c) => `ありません: ${c.path}`);
```

## 開発モード

```ts
const app = createApp({ dev: true });
```

開発モードのときだけ、次のものが動きます。本番(既定)では、固定の文言(`500 Internal Server Error` など)だけを返し、計測も記録もしません。

- 500 の本文にエラーメッセージ、404 に「もしかして: GET /hello ?」、405 にどのメソッドならあるか、バリデーションの 400 に違うところの一覧
- **エラーページと 404 ページ**: ブラウザから開いたとき(`Accept` に `text/html` があるとき)だけ。エラーが起きた行の前後のコード、ヒント、スタックトレース、ミドルウェアを通った順番と時間。エラーの場所は VS Code・Cursor・WebStorm・Zed で開けます
- **ダッシュボード(`/_senri`)**: 直近 200 件のリクエストをリアルタイムで。玉ねぎタイムライン(ミドルウェアごとの自分の時間と下流込みの時間)、ルートとミドルウェアの一覧
- **`Server-Timing` ヘッダー**: 層ごとの時間が、ブラウザの開発者ツールの「タイミング」に出ます

開発モードを決めるのに環境変数(`NODE_ENV` など)は読みません。本番では `dev: true` にしないでください。

ダッシュボードの記録とセキュリティについて:

- 記録はメモリ上だけで、再起動すると消えます。`/_senri` 自体へのリクエストと、リクエストやレスポンスのボディは記録しません
- `authorization`・`cookie`・`set-cookie` や、名前に `token`・`secret`・`session`・`api-key` などを含むヘッダーとクエリは `***` に伏せます
- **同じ PC(localhost)からしか開けません。** 接続元がループバックで、かつ `Host` も `localhost` などのときだけです。それ以外は `/_senri` がないものとして扱います(ふつうの 404)
- 接続元は `app.fetch` の2つ目の引数から取ります。`fetch: (req) => app.fetch(req)` のように包むと渡らないので、`(req, info) => app.fetch(req, info)` としてください
- Docker などのコンテナの中で動かすと、接続元が localhost に見えないので、ダッシュボードは開けません

## 性能

Hono 4.13.13・Elysia 1.4.30 と、同じルート(12 個)・同じリクエストで比べました。どれも本番モード、ミドルウェアなし、ハンドラーはテキストを返すだけです。手順とコードは [bench/](./bench/) にあり、だれでも同じものを動かせます。

**計測した環境**: Intel N100(4 コア)、Windows 11、Bun 1.4.3。ほかのアプリも動いているふだん使いの PC で、数字は回によって 1〜2 割ほどぶれます。

### プロセスの中で `app.fetch` を呼ぶ(1 リクエストあたりの時間。小さいほど速い)

ネットワークを通さず、`Request` を渡してから `Response` の本文を読み終えるまで。`bun run fetch`(mitata 1.0.34)。

| リクエスト | Senri | Hono | Elysia |
| --- | ---: | ---: | ---: |
| 静的(`/user`) | 1.63 µs | 0.90 µs | 0.58 µs |
| 静的・長い | 1.57 µs | 1.41 µs | 0.81 µs |
| パラメーター1つ | 3.00 µs | 1.60 µs | 0.90 µs |
| パラメーター3つ | 3.12 µs | 1.95 µs | 1.24 µs |
| 404 | 4.97 µs | 3.56 µs | 1.01 µs |

この計測では、Senri は3つの中でいちばん遅く、Hono の 1.1〜1.9 倍の時間がかかっています。理由の一部は分かっています。

- Senri は、どのランタイムでも同じになるよう、テキストの `Content-Type` を自分で付けます。Hono と Elysia は `new Response(text)` でランタイムに任せます
- Elysia は登録したルートからコードを生成して最適化します。Senri は Cloudflare Workers でも動くよう、`new Function` / `eval` を使いません

### HTTP 越し(1 秒あたりのリクエスト数。大きいほど速い)

3 つとも同じ `Bun.serve({ fetch })` で動かし、[oha](https://github.com/hatoo/oha) 1.16.0 で負荷をかけました(`oha -z 10s -c 64`、交互に 3 回ずつ測った中央値)。`bun run http`。

| リクエスト | Senri | Hono | Elysia |
| --- | ---: | ---: | ---: |
| 静的(`/user`) | 21,703 | 17,167 | 14,447 |
| パラメーター1つ | 16,390 | 17,461 | 21,516 |
| パラメーター3つ | 19,426 | 23,692 | 12,186 |
| 404 | 22,349 | 23,030 | 24,761 |

負荷をかける側も同じ PC で動いているので、サーバーそのものの処理が大半を占めます。この条件では 3 つとも同じくらいの範囲に入り、どれが速いとは言い切れません。順位は回によって入れ替わります。

## 例

`examples/` に、Bun・Deno・Node.js・Cloudflare Workers(workerd)で同じアプリを動かす例があります。

```bash
bun run dev                                    # Bun(保存すると再起動)
cd examples/deno && deno task start            # Deno
node examples/node/index.ts                    # Node.js
```

## ロードマップ・貢献

- これからの予定は [ROADMAP.ja.md](./ROADMAP.ja.md) にあります
- 開発のしかたは [CONTRIBUTING.md](./CONTRIBUTING.md)、変更点は [CHANGELOG.md](./CHANGELOG.md) にあります

## ライセンス

[MIT](./LICENSE) © 2026 ibuki-hum4

Senri のロゴ(`.github/assets/` の画像)は、MIT ライセンスの対象外です。
