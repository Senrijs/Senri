# Changelog

このプロジェクトの変更点です。書き方は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、バージョンは [Semantic Versioning](https://semver.org/lang/ja/) にならいます。

## [0.2.0] - 未公開

開発用の機能を本体から切り離し、本体を小さくしました。ブラウザ(Service Worker)にも正式に対応します。**破壊的変更が3つあります**(1.0 より前なので、マイナーバージョンを上げています)。

### ⚠️ 破壊的変更と移行方法

**1. 開発モードは `@senrijs/senri/dev` の `devtools()` で入れる**

`createApp({ dev: true })` はエラーになります。

```ts
// 0.1
import { createApp } from "@senrijs/senri";
const app = createApp({ dev: true });

// 0.2
import { createApp } from "@senrijs/senri";
import { devtools } from "@senrijs/senri/dev";
const app = createApp({ dev: devtools() });
```

- `devtools()` は `NODE_ENV=production` のとき何もしません(消し忘れても、本番に開発ページは出ません)
- 本番のビルドから外せば、開発用のコードはバンドルに入りません
- Deno では `--allow-env=NODE_ENV` を付けてください。読めないときは `devtools()` が無効になり、その旨を1行出します
- `createApp({ dev: someBoolean })` のように切り替えていたときは、`createApp({ dev: someBoolean ? devtools() : undefined })` にします

**2. Cookie は `@senrijs/senri/cookie` の関数で読み書きする**

| 0.1 | 0.2 |
| --- | --- |
| `c.cookie("name")` | `getCookie(c, "name")` |
| `c.cookie()` | `getCookie(c)` |
| `c.setCookie("name", "value", options)` | `setCookie(c, "name", "value", options)` |
| `c.deleteCookie("name", options)` | `deleteCookie(c, "name", options)` |

```ts
import { deleteCookie, getCookie, setCookie } from "@senrijs/senri/cookie";
```

`setCookie` / `deleteCookie` は `c` を返さなくなりました(つなげて書いていたところは、行を分けてください)。

**3. 接続元の IP アドレスは `@senrijs/senri/ip` の `getIp(c)` で読む**

| 0.1 | 0.2 |
| --- | --- |
| `c.ip` | `getIp(c)` |

```ts
import { getIp } from "@senrijs/senri/ip";
```

### 変わったこと(破壊的ではないもの)

- 本体のエラーの文言(ルートの重複、パラメーター名、メソッド名など、登録時のもの)を短い英語にしました。`devtools()` を渡すと、今までどおり日本語の説明が付きます。エラーの種類と、エラーになる条件は変わりません
- `app.routeList()` は登録順になりました(0.1 は優先順位の順)。開発モードの一覧(404 ページ・ダッシュボード)は、今までどおり優先順位の順です
- `ValidationError` の `describe()` をなくしました(開発モードの一覧は `@senrijs/senri/dev` が組み立てます)。`target` と `issues` は今までどおりです
- スキーマの書き間違い(Standard Schema でないもの、知らないキー)を登録時に知らせるのは、開発モードのときだけになりました。ハンドラーがないときは、本番でもエラーです

### 追加

- ブラウザ(Service Worker)に対応しました。CI で、Chromium のページと Service Worker の両方で動くことを確かめています
- `@senrijs/senri/dev`・`@senrijs/senri/cookie`・`@senrijs/senri/ip` の入口
- `scripts/size.ts`: バンドルのサイズを、bun build・Vite・wrangler で測る

### 小さくなったもの

`app.get("/", () => "hi")` だけのアプリを `bun build --target browser --minify` でまとめたサイズです(開発用のコードは入れない)。

| | 0.1.0 | 0.2.0 |
| --- | ---: | ---: |
| minify 後 | 151.4 KB | 13.8 KB |
| gzip 後 | 53.5 KB | 5.6 KB |

0.1.0 では、`dev: true` を使わなくても、1つのファイルにまとめると開発用のコード(約 135KB)が入っていました。

## [0.1.0] - 2026-10-26

最初の公開です。

### 追加

- Web 標準(`Request` → `Response`)のコア。Bun・Deno・Node.js・Cloudflare Workers で動く
- `serve(app)`(`@senrijs/senri/serve`): ランタイムを自動で判別して起動する。ポートは 明示 → `PORT` → `3927`
  - SIGTERM / SIGINT で、処理中のリクエストを待ってから止まる(`shutdownTimeout`・`onShutdown`・`gracefulShutdown: false`)
- ルーター
  - パラメーターのないルートは Map、それ以外は Trie。静的なセグメントが優先
  - `app.get` / `post` / `put` / `patch` / `delete` / `head` / `options` / `all`、`app.on(method | method[], path, handler)`、`app.routes({...})`
  - `QUERY` メソッド(RFC 10008)。ボディがなければ 400、Content-Type がなければ 415
  - CONNECT / TRACE / TRACK は扱わない(501)
  - `createRouter(prefix)` によるグループ化(プレフィックスのパラメーターにも型が付く)と、`app.route(prefix, app)`
- パスパラメーターの型推論
- Context: `c.status`・`c.header`・`c.json`・`c.text`・`c.set` / `c.get`・`c.query`・`c.body`・`c.cookie` / `c.setCookie` / `c.deleteCookie`・`c.ip`・`c.env`・`c.executionCtx`
- [Standard Schema](https://standardschema.dev) によるバリデーション: `app.post(path, { params, query, body }, handler)` と `c.valid()`
- ミドルウェア: 玉ねぎモデル、パス指定。標準で `logger`・`cors`・`secureHeaders`・`bodyLimit`・`health`(`/healthz`・`/readyz`)、`@senrijs/senri/static` の `serveStatic`
- 開発モード(`createApp({ dev: true })`)
  - エラーページ(該当コード・ヒント・エディタで開く)と 404 ページ(もしかして)
  - `/_senri` ダッシュボード(リクエスト一覧、玉ねぎタイムライン、ルートとミドルウェア)
  - 層ごとの時間を載せた `Server-Timing` ヘッダー
- Cloudflare Workers: `export default app`、`createApp<{ Bindings; Variables }>()`
- `bench/`: Hono・Elysia と同じ条件で比べるベンチマーク(ルーター単体・プロセス内・HTTP)

[0.2.0]: https://github.com/Senrijs/Senri/releases/tag/v0.2.0
[0.1.0]: https://github.com/Senrijs/Senri/releases/tag/v0.1.0
