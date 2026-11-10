<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Senrijs/Senri/main/.github/assets/senri-wordmark-dark.svg">
    <img src="https://raw.githubusercontent.com/Senrijs/Senri/main/.github/assets/senri-wordmark-light.svg" alt="Senri" width="320">
  </picture>
</p>

<p align="center">
  Web 標準の <code>Request</code> / <code>Response</code> だけで書かれた、小さな Web フレームワーク。<br>
  Bun・Deno・Node.js・Cloudflare Workers・ブラウザ(Service Worker)で、同じコードが動きます。
</p>

```ts
import { createApp } from "@senrijs/senri";
import { devtools } from "@senrijs/senri/dev";
import { serve } from "@senrijs/senri/serve";

const app = createApp({ dev: devtools() });      // 開発中の親切なエラーページなど。NODE_ENV=production では何もしない

app.get("/hello", () => "こんにちは!");          // 文字列 → text/plain
app.get("/users/:id", ({ id }) => ({ id }));    // オブジェクト → JSON(id の型はパスから推論)

serve(app);   // Bun でも Deno でも Node.js でも
```

本番のビルドでは `dev: devtools()` を外すと、開発用のコードがバンドルに入らず、本体だけ(minify して約 16KB)になります([開発モード](#開発モード))。

- **返した値がレスポンスになる。** 文字列はテキスト、オブジェクトは JSON。`Response` もそのまま返せます
- **型はパスから。** `/users/:id` と書けば、ハンドラーの `id` に型が付きます。[Standard Schema](https://standardschema.dev)(Zod・Valibot・ArkType など)で、パラメーター・クエリ・ボディも確かめられます
- **開発モードが親切。** エラーページ(該当コード・ヒント・エディタで開く)、404 の「もしかして」、リクエストを玉ねぎのように見られるダッシュボード(`/_senri`)、層ごとの `Server-Timing`
- **どこでも動く。** Web 標準の API だけで書いていて、`eval` も `new Function` も使いません。ブラウザの Service Worker でも動きます

## はじめる

```bash
npm create senri@latest my-app
```

フォルダ名や `--template`(ランタイム: Bun・Node.js・Deno・Cloudflare Workers)を省くと、その分を聞かれます(両方渡せば質問なし)。`devtools()` と `serve(app)`(Workers は `export default app`)が入った、すぐ動く最小のアプリができます。作り終わると、そのランタイムで動かすコマンドが表示されます。

| ランタイム | 起動 | URL |
| --- | --- | --- |
| Bun | `bun install` → `bun run dev` | http://localhost:3927 |
| Node.js | `npm install` → `npm run dev` | http://localhost:3927 |
| Deno | `deno task dev` | http://localhost:3927 |
| Cloudflare Workers | `npm install` → `npm run dev` | http://localhost:8787 |

```bash
bun create senri my-app
pnpm create senri my-app
deno run -A npm:create-senri my-app
npm create senri@latest my-app -- --template workers   # 質問なしで作る(bun / node / deno / workers)
```

### 既存のプロジェクトに入れる

```bash
npm install @senrijs/senri   # Node.js / Bun
bun add @senrijs/senri
deno add jsr:@senrijs/senri
```

Node.js は 22 以降で動きます(`create-senri` の Node.js のテンプレートは、TypeScript をそのまま動かすので 22.18 以降)。

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
- `getIp(c)`(`@senrijs/senri/ip`)は、Cloudflare が付ける `CF-Connecting-IP` を読みます(Workers で動いているときだけ)
- 開発モードのダッシュボードは作りません(`/_senri` はふつうの 404)。エラーページは出ますが、該当コードは出ません
- wrangler は1つのファイルにまとめるので、`dev: devtools()` を残すと、開発用のコード(約 190KB)もバンドルに入ります。本番のビルドでは外してください
- Workers では `NODE_ENV` が読めないので、`devtools()` は `localhost` へのリクエスト(`wrangler dev`)のときだけ開発用の出力をします([開発モード](#開発モード))
- 静的ファイルは `@senrijs/senri/static` ではなく、Workers の [Static Assets](https://developers.cloudflare.com/workers/static-assets/) で配ってください

### ブラウザ(Service Worker)

Service Worker の `fetch` イベントに、そのまま答えられます。サーバーなしで、ページからの `fetch` に Senri が返事をします。

```ts
// sw.ts(bun build や Vite でまとめて、navigator.serviceWorker.register("/sw.js") で登録する)
import { createApp } from "@senrijs/senri";

const app = createApp();
app.get("/api/todos/:id", ({ id }) => ({ id, done: false }));

self.addEventListener("fetch", (e) => {
    if (new URL(e.request.url).pathname.startsWith("/api/")) e.respondWith(app.fetch(e.request));
});
```

- ページの中で `app.fetch(new Request(...))` を直接呼ぶこともできます
- CI で、Chromium のページと Service Worker の両方で動くことを確かめています(`scripts/browser.ts`)

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

### 本文の大きさの上限(maxRequestBodySize)

`serve()` の `maxRequestBodySize`(バイト数)で、サーバー全体の本文の上限を決められます。超えたら 413 です。`Infinity` で上限をなくせます。

- 省略したときは、ランタイムの既定のままです。**Bun では、128 MiB を超える本文が切られます**(`Bun.serve` の既定)。Node.js と Deno には上限がありません
- Bun で大きいファイルを受けるとき(`multipart()` など)は、`maxRequestBodySize` を上げてください

```ts
serve(app, { maxRequestBodySize: 1024 * 1024 * 1024 }); // 1 GiB
```

- Content-Length があれば読む前に断り、ない(チャンク転送)ときは読みながら数えます
- これはサーバー全体の上限です。ルートごとの上限は `bodyLimit()`、`uploadLimit()`、`multipart()` の上限で付けてください
- Node.js の `node:http` は、リクエストを受け取り終えるまでの時間を既定で 5 分にしています(`requestTimeout`)。遅い回線で大きいファイルを送ると、途中で 408 になることがあります

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
- HEAD は、登録していなければ GET のルートで処理してボディを捨てます。OPTIONS は、登録していなければ 204 と `Allow` を返します(ワイルドカードのルートは数えません)
- `QUERY` メソッド([RFC 10008](https://www.rfc-editor.org/rfc/rfc10008.html))は `app.on("QUERY", path, handler)` で登録します。ボディがなければ 400、Content-Type がなければ 415 にします
- CONNECT / TRACE / TRACK は扱いません(501)
- 同じメソッド + 同じパス(パラメーター名だけ違うものも含む)を2回登録するとエラーになります
- 省略できるパラメーター(`:id?`)や正規表現(`:id{[0-9]+}`)はありません。こう書くと登録時のエラーになります。値はハンドラーか[スキーマ](#バリデーション)で確かめてください

### ハンドラーの戻り値

| 返すもの | レスポンス |
| --- | --- |
| 文字列 | `text/plain; charset=utf-8` |
| オブジェクト・配列 | JSON |
| `Blob` / `ArrayBuffer` / `Uint8Array` など / `ReadableStream` / `FormData` / `URLSearchParams` | そのままボディ |
| `Response` | そのまま |

関数を返す(呼び忘れ)のは型エラーで、実行時も 500 になります。

### レスポンスのヘルパー

```ts
import { setCookie } from "@senrijs/senri/cookie";

app.get("/", (_, c) => c.html("<h1>こんにちは</h1>"));   // text/html; charset=utf-8
app.get("/old", (_, c) => c.redirect("/new", 301));      // 既定は 302
app.post("/login", (_, c) => {
    setCookie(c, "session", "abc");                      // c.header() で設定したものも付く
    return c.redirect("/dashboard", 303);
});
```

- `c.html()` は本文をそのまま返します。利用者の入力を入れるときは、自分でエスケープしてください
- `c.redirect()` の status は 301 / 302 / 303 / 307 / 308 だけです。`c.status()` は見ません。`/login` のような相対パスも渡せます
- `c.header("location", ...)` より `c.redirect()` の値が優先です
- ASCII 以外はどのランタイムでも同じ形にエンコードします。絶対 URL は `new URL()` に任せ(`https://例え.jp/` → `https://xn--r8jz45g.jp/`)、相対パスは ASCII 以外の部分だけパーセントエンコードします(`%2F` などは二重にしません)
- CR / LF を含む値と、エンコードできない値はエラーになります。ただし、ほかのサイトへの URL は通すので、`c.query("next")` のような外からの値は、行き先を確かめてから渡してください(オープンリダイレクトの対策)
- ブラウザの Service Worker とページの中の `app.fetch()` では、`Response` から `Set-Cookie` が消えるので、Cookie は付きません(ブラウザの制限です)

### ストリーミング(SSE)

```ts
import { stream, streamSSE, streamText } from "@senrijs/senri/streaming";

app.get("/events", (_, c) =>
    streamSSE(c, async (s) => {
        s.onAbort(() => console.log("切断されました"));
        for (let i = 0; !s.aborted; i++) {
            await s.writeSSE({ event: "tick", id: String(i), data: String(i) });
            await s.sleep(1000);
        }
    }),
);
```

- `stream()` はバイト列、`streamText()` はテキスト、`streamSSE()` は Server-Sent Events を少しずつ送ります
- クライアントが切断すると `s.aborted` が `true` になり、`s.onAbort()` で登録した関数が動きます。`s.write()` は読み手が追いつくまで待ちます
- 途中のエラーで 500 は返せません。`onError` を渡すと最後に書き込めて、正常に閉じます。渡さなければ、ログに出して接続を切ります(途中までのダウンロードが完了に見えないように)
- `streamSSE()` は最初に `: connected` のコメントを送るので、ヘッダーはすぐ届きます。`compress()` は SSE を圧縮しません
- Cloudflare Workers(workerd で確認)では、切断に気づくのは次に書き込んだときです。静かなストリームでは `onAbort` は呼ばれず、`streamSSE()` の既定の heartbeat があれば 15 秒以内に呼ばれました。急ぐ後片付けは任せないでください。途中のエラーでも、ランタイムが本文を正常に閉じます
- `streamSSE()` は既定で5秒ごとに `: ping` のコメントを送ります(heartbeat)。Bun の `Bun.serve` は既定で約10秒(早いと 8.8 秒)、プロキシもよく1分ほどで、黙っている接続を切るからです。クライアントはコメントを無視します。間隔は `{ heartbeat: 15_000 }` で変えられ、`{ heartbeat: false }` で止められます(最初の `: connected` は残ります)。読み手が止まっている間は送りません

### 大きいファイルの受け取り(マルチパート)

```ts
import { multipart } from "@senrijs/senri/multipart";

app.post("/upload", async (_, c) => {
    for await (const part of multipart(c, { maxFileSize: 100 * 1024 * 1024 })) {
        if (part.filename !== undefined) await save(crypto.randomUUID(), part.stream);
        else console.log(part.name, await part.text());
    }
    return "ok";
});
```

- `multipart/form-data` を1パーツずつ読みます。本文を全部メモリに読まないので、大きいファイルを届いた分からそのまま保存先(ファイル、オブジェクトストレージなど)へ流せます。保存先は自由です
- パーツは `name`、`filename`(フィールドなら `undefined`。ファイルを選ばなかったファイル欄は `""`)、`contentType`(なければ `text/plain`)、`headers`、`stream`、`text()`、`bytes()` を持ちます
- 上限: `maxParts`(既定 100)、`maxFileSize`(既定 10 MiB)、`maxFieldSize`(既定 64 KiB)、`maxHeaderSize`(パーツのヘッダー、既定 8 KiB)、`maxTotalSize`(本文全体、既定なし)。超えたら 413 です。壊れた本文や `boundary` がないときは 400、multipart でなければ 415 です
- ループが次へ進むと、読み残したパーツは読み飛ばします。そのあとで前のパーツの `stream` を読むとエラーなので、保存は `await` してから次へ進んでください。`break` で抜けると、それ以上は読みません
- 本文を読んだあと(`c.body()`、`uploadLimit()`、ルートの `body` のスキーマ)や、2回目に呼ぶとエラーです。小さいファイルを `File` で受け取って種類まで確かめるなら `uploadLimit()`、大きいファイルを流すなら `multipart()` と、ルートごとに使い分けてください
- `part.filename` と `part.contentType` は、送られてきたそのままの値です。保存先のパスには使わず、`crypto.randomUUID()` などで決めるか `safeFileName()` を通してください
- 本文全体の上限は `maxTotalSize` で付けられます。`bodyLimit()` を一緒に使ってもかまいません
- Bun では、`serve()` の既定で 128 MiB を超える本文が切られます。`maxFileSize` を上げるときは、`serve()` の [`maxRequestBodySize`](#本文の大きさの上限maxrequestbodysize) も上げてください

### グループ化

```ts
import { createRouter } from "@senrijs/senri";

const posts = createRouter("/users/:id/posts");
posts.get("/", ({ id }) => `user ${id} の投稿`);          // id に型が付く
posts.get("/:postId", ({ id, postId }) => `${id} / ${postId}`);
app.route(posts);

app.route("/admin", adminApp);                             // 別の createApp() をつなぐこともできる
```

### ルートの表(defineRoutes)

ルートを表にまとめて定義すると、ルートの型(パス・パラメーター・スキーマ・ハンドラーの戻り値)を持ったまま、ファイルの外に出せます。

```ts
import { createApp, defineRoutes, endpoint, mergeRoutes } from "@senrijs/senri";
import { z } from "zod";

// キーは "メソッド /パス"。パラメーターはキーから型が付く
export const userRoutes = defineRoutes({
    "GET /users/:id": ({ id }) => ({ id }),
    // スキーマを付けるルートは endpoint(schemas, handler) で包む(app.post(path, schemas, handler) と同じ引数)
    "POST /users": endpoint({ body: z.object({ name: z.string() }) }, (_, c) => ({ created: c.valid("body").name })),
});

// 前置きは 2 段で書く。前置きのパラメーターも、中のハンドラーで型が付く
export const orgRoutes = defineRoutes("/orgs/:orgId")({
    "GET /": ({ orgId }) => `org ${orgId}`,                    // "GET /orgs/:orgId"
    "GET /members/:memberId": ({ orgId, memberId }) => ({ orgId, memberId }),
});

// 表を合わせる(同じキーが 2 つあればエラー)
export const routes = mergeRoutes(userRoutes, orgRoutes);

const app = createApp();
app.routes(routes);
```

- 前置きは `/` で始め、`/` で終わらないように書きます(`"/users"`)
- `c.get()` に型を付けるときは、前置きと一緒にアプリの型を渡します: `defineRoutes<"/admin", Vars>("/admin")({ ... })`
- パスの書き方の確認と、同じルートの 2 回登録の確認は、`app.routes()` に渡したときに `app.get()` と同じく行います

#### ルートごとのミドルウェア

```ts
const auth: Middleware<{ user: User }> = async (c, next) => {
    const user = await findUser(c.req.headers.get("authorization"));
    if (!user) {
        c.status(401);
        return "ログインしてね";
    }
    c.set("user", user);
    await next();
};

// 表の全部のルートに付ける(前置きがなければ "")
export const adminRoutes = defineRoutes("/admin", { use: [auth] })({
    "GET /me": (_, c) => c.get("user"),                                         // User | undefined
    // このルートだけに付ける
    "DELETE /users/:id": endpoint({ use: [requireOwner], params: idSchema }, ({ id }) => deleteUser(id)),
});
```

- 動く順番は、アプリの `app.use()` → 表の `use` → ルートの `use` → スキーマの確認 → ハンドラーです。ミドルウェアが値を返したら、スキーマの確認(本文を読む)の前に止まります
- ミドルウェアを `Middleware<{ user: User }>` のように書くと、`c.get("user")` に型が付きます
- そのルートに当たったリクエストでだけ動きます。開発モードのタイムラインと、ダッシュボードの「ルート」の行にも出ます

### パスのルール

- 末尾スラッシュと連続スラッシュは無視します。`/users`、`/users/`、`//users` はどれも同じです
- パスはセグメントごとにパーセントデコードされます。`/こんにちは` のようにそのまま書いたルートにマッチします
- デコードできないパスと、`%2F`(エンコードされた `/`)を含むパスは 400 です
- 正規化・デコード済みのパスは `c.path` で読めます。パスで判定するミドルウェアは、`req.url` ではなく `c.path` か `app.use("/admin", mw)` を使ってください

### ワイルドカード

最後のセグメントを `*` にすると、そのパスとその下のすべてに当たります。残りのパスは `"*"` で受け取れます。

```ts
app.get("/docs/*", ({ "*": page }) => `page: ${page}`);
app.get("/users/:id/files/*", ({ id, "*": path }) => `${id}: ${path}`);
app.get("/*", (_, c) => c.html(indexHtml));   // SPA の fallback(/ にも当たる)
```

| `/docs/*` へのリクエスト | `"*"` の値 |
| --- | --- |
| `/docs`、`/docs/` | `""` |
| `/docs/a`、`/docs/a/`、`/docs//a` | `"a"` |
| `/docs/a/b` | `"a/b"` |
| `/docsx` | 当たらない |

- 書けるのは最後のセグメント全体だけです。`/a/*/c`、`/*.js`、`/files*`、`/*name` は登録時のエラーになります
- 優先順位は、登録順によらず 静的 → パラメーター → ワイルドカード です。`/a/b/c` の枝で見つからなければ、戻って `/a/*` を試します
- **405 と自動の OPTIONS には数えません。** `GET /docs/*` だけがあるパスに POST や OPTIONS を送ると 404 です。答えたいときは、`app.post`・`app.options`・`app.all` で登録してください。`/docs/a` に静的なルートもあるときの 405 の `Allow` には、そのルートのメソッドだけが入ります
- 値はセグメントごとに1回だけデコードされています。もう一度デコードしないでください(`%252F` は `%2F` のままです)。`%2F` を含むパスはルートに届く前に 400 になるので、値の `/` は区切りだけです
- **値をファイルのパスに使わないでください。** `\`・`:`・NUL は値に入ります(`/docs/..%5C..%5Csecret` の値は `..\..\secret`)。ファイルを配るなら、これらを確かめている `serveStatic` を使ってください
- ミドルウェアの `app.use("/docs/*", mw)` は `app.use("/docs", mw)` と同じ意味です

## リクエストを読む

```ts
import { getCookie, setCookie } from "@senrijs/senri/cookie";
import { getIp } from "@senrijs/senri/ip";

app.post("/search", async (_, c) => {
    c.query("page");               // "2"(なければ undefined。c.query() で全部)
    c.queries("tag");              // ["a", "b"]
    await c.body();                // Content-Type に合わせて読む(JSON・フォーム・テキスト・それ以外は ArrayBuffer)
    getCookie(c, "session");       // Cookie(getCookie(c) で全部)
    setCookie(c, "seen", "1");     // deleteCookie(c, name) で消す
    getIp(c);                      // 接続元の IP アドレス(分からなければ null)
    return "ok";
});
```

- `c.body()` は何度呼んでも同じ結果です(ミドルウェアとハンドラーの両方から読めます)
- Cookie と IP は、使わないアプリのバンドルに入らないよう、別の入口(`@senrijs/senri/cookie`・`@senrijs/senri/ip`)にしています
- `getIp(c)` はランタイムが渡す接続元を使います。`X-Forwarded-For` などのヘッダーは偽装できるので読みません
- プロキシの後ろでは `trustProxy()` を使います。`const clientIp = trustProxy({ hops: 1 })` や `trustProxy({ proxies: ["10.0.0.0/8"] })` で作った関数が、クライアントの IP を返します。`X-Forwarded-For` の先頭は信じず、右から数えます。`hops` は、プロキシを通らずにアプリへ届く環境では偽装できるので、その場合は `proxies` を使ってください
- `setCookie(c, name, value, options)` の既定は `Path=/`・`HttpOnly`・`SameSite=Lax` です
- 署名付き Cookie は `await setSignedCookie(c, name, value, secret, options)` で付けて、`await getSignedCookie(c, name, secret)` で読みます。署名は HMAC-SHA256(Web Crypto)で、確かめるときは時間が一定の比べ方(`crypto.subtle.verify`)を使います。書き換えられていたら `false`、送られていなければ `undefined` です
  - 値はクライアントから読めます(暗号化ではなく、書き換えを見つけるだけです)。秘密にしたいものは入れないでください
  - 秘密鍵は 32 バイト以上のランダムな文字列にして、コードに書かず環境変数や `c.env` から読んでください。`["新しい鍵", "古い鍵"]` のように配列で渡すと、新しい鍵で署名し、どちらの鍵の署名も受け付けます(鍵の入れ替え)
  - 署名には Cookie の名前も入るので、ある Cookie の値を別の名前の Cookie に写しても通りません
  - `maxAge` はブラウザに捨ててもらうだけなので、同じ値を後から送り直すことはできます。期限を守らせたいときは、値に期限を入れて確かめてください
  - Bun・Deno・Node.js・Cloudflare Workers・ブラウザ(Service Worker。`crypto.subtle` は HTTPS か localhost でだけ使えます)で動きます

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
- 通らなければ 400 です。本番の本文は `400 Bad Request` だけで、開発モード(`devtools()`)では、どこが違うかを一覧にします。スキーマの書き間違いも、開発モードなら登録した時点で知らせます
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

- `app.use("/admin/*", mw)` は `app.use("/admin", mw)` と同じ意味です(`/admin` 自体にも動きます)。`/a/*/c` や `/*.js` のような、ほかの場所の `*` は登録時のエラーになります
- ルートはミドルウェアより先にマッチするので、`next()` の前から `c.route`(`"/users/:id"` のようなパターン)と `c.params` が読めます
- `c.header()` で設定したヘッダーは、最後に1回だけレスポンスに足されます。`Response` を直接返したときも、エラーのときも効きます。ただし、`Content-Type` と `Location` は、レスポンス自身にあればそちらが優先です
- ミドルウェアからハンドラーへ値を渡すには `c.set` / `c.get` を使います。型は `createApp<{ user: User }>()` で決めます

### 標準のミドルウェア

```ts
import { basicAuth, bearerAuth, bodyLimit, cache, compress, cors, csrf, etag, health, ipRestriction, languageDetector, logger, methodOverride, prettyJSON, rateLimit, requestId, secureHeaders, timeout, trailingSlash, uploadLimit } from "@senrijs/senri";
import { serveStatic } from "@senrijs/senri/static";

app.use(health({ ready: () => db.isConnected() }));   // /healthz と /readyz
app.use(logger());                                     // 色付きで1行ずつ。{ format: "json" } で pino 形式
app.use(secureHeaders());                              // X-Content-Type-Options など
app.use(cors({ origin: ["https://example.com"] }));
app.use(csrf());                                       // よそのサイトからの POST などを 403 に(トークンは使わない)
app.use(bodyLimit({ maxSize: 1024 * 1024 }));          // 超えたら 413
app.use(serveStatic({ root: "./public" }));            // Bun・Deno・Node.js で静的ファイルを配る
app.use(requestId());                                  // c.get("requestId") と X-Request-Id
app.use(timeout(5000));                                // 5 秒で終わらなければ 504
app.use("/admin", basicAuth({ username: "admin", password: env.ADMIN_PASSWORD }));
app.use("/api", bearerAuth({ token: env.API_TOKEN }));
app.use(compress());                                   // gzip / deflate(1KB より小さい本文はそのまま)
app.use(etag());                                       // ETag を付けて、変わっていなければ 304
app.use(rateLimit({ windowMs: 60_000, limit: 100 }));  // 超えたら 429 と Retry-After
app.use("/admin", ipRestriction({ allow: ["192.0.2.0/24"], deny: ["192.0.2.13"] }));
app.use(trailingSlash());                              // /a/ → /a に 301
app.use("/assets", cache({ cacheControl: "public, max-age=3600" }));
app.use(languageDetector({ supportedLanguages: ["ja", "en"], fallbackLanguage: "en" }));  // c.get("language")
app.use(prettyJSON());                                 // ?pretty で JSON を整形
app.use("/photos", uploadLimit({ maxTotalSize: 20 * 1024 * 1024, types: ["image/png"] }));
```

- `requestId()`: 受け取った `X-Request-Id` は既定で使いません。信頼できるプロキシの後ろでは `trustIncoming: true` にしてください(128 文字までの `A-Z a-z 0-9 . _ = + / -` だけを受け付け、それ以外は作り直します)
- `timeout()`: 時間切れでも処理そのものは止まりません。同期のループ中はタイマーも動きません。`c.req.signal` は切断だけを表すので、外部への呼び出しを止めるには `AbortSignal.timeout()` と組み合わせてください
- `csrf()`: GET・HEAD・OPTIONS 以外で、ブラウザが付ける `Sec-Fetch-Site` を見て、よそのオリジンからなら 403 にします。`Sec-Fetch-Site` のない古いブラウザでは、`Origin` のホストを `Host` と比べます(スキームは比べないので、TLS を終えるプロキシの後ろでも動きます)。どちらのヘッダーもないリクエストは、ブラウザからではない(curl やサーバーどうし)ので通します。ほかの自分のサイトからも受けるときは、`app.use(csrf({ origin: ["https://admin.example.com"] }))` のように、そのパスにかかる 1 つの `csrf()` に渡してください(`app.use(csrf())` のあとに `app.use("/api", csrf({ origin }))` を足しても、先の `csrf()` が 403 で止めるので届きません)。GET と HEAD は確かめないので、状態を変える処理を置かないでください。プロキシが `Host` を書き換えるときも、`origin` に正しいオリジンを入れてください
- `basicAuth()` / `bearerAuth()`: 失敗すると 401 と `WWW-Authenticate` を返します。固定の値の代わりに `verifyUser` / `verifyToken` で検証することもできます(`true` を返したときだけ通します)。`cors()` と一緒に使うときは `cors()` を先に登録してください
- `compress()`: `etag()` と一緒に使うときは `compress()` を先に登録してください。少しずつ流すストリームは、途中で止まって見えないように圧縮しません
- `etag()`: GET の 2xx に弱い ETag を付けます。ハンドラーは毎回動きます。ストリームの本文と HEAD には付けません
- `ipRestriction()`: `deny` を先に見ます。拒否は 403 です。IP が分からないときも 403 にします(テストでは `allowUnknown: true`)。プロキシの後ろでは `ip: trustProxy({ hops: 1 })` のように渡してください
- `rateLimit()`: 固定ウィンドウで、既定のキーは IP です(IPv6 は /64 ごと)。IP が分からないリクエストは制限せず、最初の 1 回だけ警告します。既定の保存先はプロセスのメモリなので、Workers では isolate ごとの制限になり、全体の制限にはなりません。`store` で Redis などに差し替えられます
- `methodOverride(app)`: HTML のフォームから PUT / PATCH / DELETE を送れるようにします。ルートはミドルウェアより先に決まるので、ミドルウェアではなく `app.fetch` を包みます(`serve(methodOverride(app))`、Workers では `export default methodOverride(app)`)。上書きできるのは POST だけです。`multipart/form-data` のフォームは読まないので、その場合は `X-HTTP-Method-Override` ヘッダーを使ってください。使うと Node では全リクエストが、`Request` と `Response` を作らない道を外れます
- `trailingSlash()`: `/a` と `/a/` は同じルートなので、正規の形にそろえたいとき(SEO)に使います。GET / HEAD で、ルートに一致したパスだけをリダイレクトします
- `cache()`: GET / HEAD の 2xx と 304 に `Cache-Control` と `Vary` を付けるだけで、保存はブラウザや CDN に任せます。`etag()` より先に登録してください。`setCookie()` の Cookie はミドルウェアから見えないので、個人のページがあるパスに `public` を付けないでください
- `languageDetector()`: クエリ(`lang`)、Cookie(`language`)、`Accept-Language` の順に見ます。`c.get("language")` は必ず `supportedLanguages` のどれかです。Cookie には書き込みません
- `prettyJSON()`: `compress()` と `etag()` のあとに登録してください。1 MiB を超える本文とストリームは整形しません
- `uploadLimit()`: multipart のファイルの大きさ(`maxTotalSize` は必須、`maxFileSize`)、数(`maxFiles`)、種類(`types`、`extensions`)を確かめます。超えたら 413、種類が違えば 415 です。PNG、JPEG、GIF、WebP、PDF は中身の先頭のバイトも確かめます。読んだ結果は `c.body()` で受け取れて、ルートのスキーマも検証のあとに動きます。`c.body()` は全部メモリに読むので、使うメモリは `maxTotalSize` までです。送られたファイル名(`file.name`)は `../../etc/passwd` のようなものかもしれないので、保存先に使わないでください(`crypto.randomUUID()` などで自分で決めるか、`safeFileName()` を通してください)
- `health()`: `/healthz` は応答できれば 200。`/readyz` は `ready()` が true なら 200、false・例外・止まり始めたあとは 503
- `logger()`: 色は既定でオンです。ファイルや CI に流すときは `color: false` にしてください
- `secureHeaders()`: Content-Security-Policy と Cross-Origin-Embedder-Policy は既定でオフです(アプリによって壊れやすいので)
- `serveStatic()`: ドットファイルは既定で配りません。root の外(シンボリックリンクを含む)には出ません。`prefix: "/static/*"` は `prefix: "/static"` と同じ意味です

## エラー

```ts
import { HttpError } from "@senrijs/senri";

app.get("/secret", () => {
    throw new HttpError(403, "見せられません");      // message はそのままクライアントに返る
});

app.onError((err, c) => ({ error: "something went wrong" }));
app.notFound((c) => `ありません: ${c.path}`);
```

### 見つからないとき(`c.notFound()`)

ルートはあるけれど中身がないときは、`c.notFound()` で `app.notFound` のハンドラー(なければ既定のもの)に回せます。ミドルウェアからも呼べます。

```ts
app.get("/items/:id", ({ id }, c) => {
    const item = items.get(id);
    if (!item) return c.notFound();
    return item;
});
```

- **`return c.notFound()` と書いてください。** 例外で止まるので `c.notFound();` だけでも以降は動きませんが、`(_, c) =>` のように `c` の型を明示していないと、TypeScript は「止まる」と扱いません(`item` が `undefined` のままになり、最後に書くと戻り値が型エラーになります)
- `new HttpError(404)` とほぼ同じ動きです。違うのは行き先で、`onError` ではなく `app.notFound` のハンドラーに回ります
  - 外側のミドルウェアの `await next()` は投げずに、404 のレスポンスを返します。`res.status` で判定してください
  - 同じ関数の `try/catch` には捕まります。`if (err instanceof HttpError) throw err` で投げ直してください
- `c.header()` で設定したヘッダー(`Set-Cookie`・CORS など)は 404 にも付きます。ロガーとダッシュボードには 404 として記録されます
- `app.notFound` のハンドラーの中で呼ぶと、既定の 404 になります。`onError` の中で呼ぶと、ほかのエラーを投げたときと同じく、固定の 500 になります
- `app.route()` でつないだアプリから呼んでも、親のハンドラーが使われます
- 開発モードの 404 に「もしかして」が出るのは、ルートがなかったときだけです

### Problem Details(RFC 9457)

エラーを `application/problem+json` で返したいときは、`@senrijs/senri/problem` を使います。選んだときだけ変わり、既定のエラーの形(テキスト)はそのままです。

```ts
import { ProblemError, problem, problemDetails } from "@senrijs/senri/problem";

const problems = problemDetails();         // problemDetails({ validationErrors: true }) で、バリデーションのどこが違うかも返す
app.onError(problems.onError);
app.notFound(problems.notFound);

app.post("/transfer", () => {
    throw new ProblemError(403, {
        type: "https://example.com/probs/out-of-credit",
        title: "You do not have enough credit.",
        detail: "Your current balance is 30, but that costs 50.",
        extensions: { balance: 30 },
    });
});
app.get("/legacy", (_, c) => problem(c, { status: 410, detail: "Use /v2 instead." })); // 投げずに返す
```

- `type` を省くと `about:blank` になり、`title` は status の名前(`"Not Found"` など)になります
- `ProblemError` 以外の `HttpError`(ルーターの 405、`basicAuth()` の 401、`rateLimit()` の 429 など)は、`message` が status だけ(`"405 Method Not Allowed"`)なら `detail` を付けず、それ以外なら `detail` にします。`Allow`・`WWW-Authenticate`・`Retry-After` などのヘッダーは残ります
- `HttpError` でないエラーは、既定と同じく中身を出さず、`title` だけの 500 にします
- バリデーションのエラーの中身(`errors`)は、スキーマの作りが外から見えるので、既定では出しません
- `ProblemError` は `HttpError` なので、`problemDetails()` を使わないアプリでは、`detail`(なければ `title`)をテキストで返すふつうのエラーになります
- ほかの `app.onError` と同じく、開発モードのエラーページや 404 ページも置き換わります。開発中は使わず、本番だけで設定することもできます

## 開発モード

```ts
import { createApp } from "@senrijs/senri";
import { devtools } from "@senrijs/senri/dev";

const app = createApp({ dev: devtools() });
```

開発用の機能は、すべて `@senrijs/senri/dev` にあります。本体(`@senrijs/senri`)は開発用のコードを一切 import しないので、`devtools()` を渡さなければ、どのバンドラーでも開発用のコードは入りません。`devtools()` を渡したときだけ、次のものが動きます。渡さなければ、固定の文言(`500 Internal Server Error` など)だけを返し、計測も記録もしません。

- 500 の本文にエラーメッセージ、404 に「もしかして: GET /hello ?」、405 にどのメソッドならあるか、バリデーションの 400 に違うところの一覧、登録時のエラーに詳しい説明
- **エラーページと 404 ページ**: ブラウザから開いたとき(`Accept` に `text/html` があるとき)だけ。エラーが起きた行の前後のコード、ヒント、スタックトレース、ミドルウェアを通った順番と時間。エラーの場所は VS Code・Cursor・WebStorm・Zed で開けます
- **ダッシュボード(`/_senri`)**: 直近 200 件のリクエストをリアルタイムで。玉ねぎタイムライン(ミドルウェアごとの自分の時間と下流込みの時間)、ルートとミドルウェアの一覧
- **`Server-Timing` ヘッダー**: 層ごとの時間が、ブラウザの開発者ツールの「タイミング」に出ます
- **書き間違いの警告**: 最初のリクエストのときに、どのルートにも当たらないパス指定のミドルウェア(`app.use("/admni", ...)`)と、ほかのフレームワークの書き方に見えるパス(`/a?`、`/[id]`、`/{id}`)を、コンソールとダッシュボードで知らせます。同じ警告は1回だけです。ルートなしで自分で返すミドルウェアなら、無視して構いません

**開発用の画面とメッセージは、日本語と英語に対応しています。**

| 対象 | 言語の決め方 |
| --- | --- |
| エラーページ・404 ページ・ダッシュボード・開発モードのテキストのレスポンス | リクエストの `Accept-Language` |
| ターミナルの警告・案内、登録時のエラーの説明 | 環境変数 `LC_ALL` → `LC_MESSAGES` → `LANG` → OS の言語 |

- 決められないとき(`Accept-Language` がない curl、知らない言語、`LANG=C` など)は英語です
- `devtools({ lang: "ja" })` で、画面もターミナルも固定できます。`serve()` の案内は `serve(app, { lang: "ja" })` で固定できます
- **Windows の Bun は OS の言語を読めず英語になるので、日本語にしたいときは `lang` か `LANG` を指定してください**(`LANG=ja_JP.UTF-8` など)
- Deno で環境変数を読む許可(`--allow-env=LANG` など)がないときは、環境変数を飛ばして OS の言語を見ます
- ダッシュボードの記録の、エラーの説明はリクエストのときの言語で残ります。本番でも出るエラーメッセージは翻訳しません

本番での扱いは、2通りあります。**本番のビルドから外すのが確実です。**

- **本番のビルドから `devtools()` を外す(`dev` を渡さない)**: 開発用のコードがバンドルに入らず、サイズが最小になります。依存は増えません(同じパッケージの別の入口なので)
- **`dev: devtools()` を残して `NODE_ENV=production` にする**: `devtools()` は何もしないので、本番に開発ページは出ません。ただし、1つのファイルにまとめるバンドラー(Workers の wrangler など)では、コードが入ったままなのでサイズは減りません

**どのリクエストに開発用の出力をするかは、`NODE_ENV` で決まります。**

| `NODE_ENV` | 開発用の出力 |
| --- | --- |
| `production` | しない(`devtools()` は何もしない) |
| `development` / `test` | 全部のリクエスト |
| 未設定・それ以外(`staging` など) | **localhost へのリクエストだけ** |

- 「localhost へのリクエスト」は、リクエストの URL のホスト名が `localhost`(`127.0.0.1`・`[::1]`・`*.localhost` を含む)で、**かつ**接続元がループバック(同じ PC)のときです。Node.js・Bun・Deno では、URL のホスト名は `Host` ヘッダーから作られ、だれでも付けられるので、接続元も見ます(接続元は `app.fetch` の2つ目の引数から取ります。ダッシュボードと同じです)
- それ以外のリクエストには、本番と同じ固定の文言だけを返し、エラーページ・ルートの一覧・`Server-Timing` は出しません。そうしたリクエストが初めて来たときに、1回だけその旨をログに出します
- Docker の中で動かしてホストのブラウザから開くとき、同じ LAN の別の機器(スマートフォンなど)から開くとき、`localhost` 以外のホスト名で開くときは、`NODE_ENV=development` を付けてください。`bun test` は `NODE_ENV=test` を入れるので、テストでは全部に出ます
- 同じ PC のリバースプロキシの裏では、プロキシが `Host: localhost` をそのまま転送すると、localhost へのリクエストに見えてしまいます。本番では `NODE_ENV=production` にするか、`devtools()` を外してください

**Cloudflare Workers とブラウザ(Service Worker)では `NODE_ENV` が読めない**ので、いつも localhost へのリクエストだけです。ここでは URL をプラットフォームが決めるので、URL のホスト名だけを見ます。

- Workers では、本番の Worker に `localhost` のリクエストは届かない(Cloudflare は登録されたドメインのリクエストしか渡さない)ので、`wrangler dev`(`localhost:8787`)のときだけ有効になります
- ブラウザでは、開発中のサイト(`localhost`)のときだけ有効になります
- それでも、本番のビルドからは外すのが確実です。消し忘れても漏れないようにするための、念のための仕組みです

Deno では、`NODE_ENV` を読む許可(`--allow-env=NODE_ENV`)がないと本番かどうか分からないので、`devtools()` は無効になり、その旨を1行出します。

0.1 の `createApp({ dev: true })` は、0.2 からエラーになります([CHANGELOG](./CHANGELOG.md) に移行方法があります)。

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

3 つとも同じ `Bun.serve({ fetch })` で動かし、[oha](https://github.com/hatoo/oha) 1.16.0 で負荷をかけました(`oha -z 10s -c 64`、交互に 3 回ずつ測った中央値)。ベンチは今は wrk で測る形に変えたので、ベンチ用の VM で測り直した結果に置き換える予定です。

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
