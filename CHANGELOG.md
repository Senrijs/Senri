# Changelog

このプロジェクトの変更点です。書き方は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、バージョンは [Semantic Versioning](https://semver.org/lang/ja/) にならいます。

## [0.1.0] - 未公開

最初の公開です。

### 追加

- Web 標準(`Request` → `Response`)のコア。Bun・Deno・Node.js・Cloudflare Workers で動く
- `serve(app)`(`senri/serve`): ランタイムを自動で判別して起動する。ポートは 明示 → `PORT` → `3927`
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
- ミドルウェア: 玉ねぎモデル、パス指定。標準で `logger`・`cors`・`secureHeaders`・`bodyLimit`・`health`(`/healthz`・`/readyz`)、`senri/static` の `serveStatic`
- 開発モード(`createApp({ dev: true })`)
  - エラーページ(該当コード・ヒント・エディタで開く)と 404 ページ(もしかして)
  - `/_senri` ダッシュボード(リクエスト一覧、玉ねぎタイムライン、ルートとミドルウェア)
  - 層ごとの時間を載せた `Server-Timing` ヘッダー
- Cloudflare Workers: `export default app`、`createApp<{ Bindings; Variables }>()`
- `bench/`: Hono・Elysia と同じ条件で比べるベンチマーク(ルーター単体・プロセス内・HTTP)

[0.1.0]: https://github.com/Senrijs/Senri/releases/tag/v0.1.0
