# ロードマップ

> 千里の道も一歩から。

Senri がこれから向かう先です。バージョンは目標であって日付の約束ではなく、フィードバックに応じて変わることがあります。
アイデアや要望は [Issues](https://github.com/Senrijs/Senri/issues) にお気軽にどうぞ。

[English](./ROADMAP.md) · **日本語**

## できていること

- Web 標準(`Request` → `Response`)のコアが **Bun・Deno・Node.js・Cloudflare Workers・ブラウザ** で動く
- ランタイムを自動判別する `serve(app)`(ポートは 明示 → `PORT` → `3927`)
- パスパラメーターを第1引数で受け取れるルーター、静的パス優先、親切な 404 / 405
- 返り値がそのままレスポンスになる(文字列 → テキスト、オブジェクト → JSON)
- Context(`c.status`・`c.header`・`c.json`・`c.text`・`c.set` / `c.get`)、`HttpError`、`onError`、`notFound`
- 玉ねぎモデルのミドルウェア、パス指定のミドルウェア
- パスパラメーターの型推論
- ロガー(見やすい表示 / pino 互換の JSON)
- 開発モード: エラーページ(該当コード・ヒント・エディタで開く)と 404 ページ(「もしかして」)
- `/_senri` 開発ダッシュボード: リアルタイムのリクエスト一覧、玉ねぎタイムライン、ルートとミドルウェア

## 0.1.0 — 最初の公開(2026-10-26 公開済み)

*すぐに使えて、ほかにない開発体験があって、どこでも動く。*

- [x] クエリ・ボディ・Cookie のヘルパー
- [x] ルートのグループ化(`app.route(prefix, subApp)`)
- [x] `app.on`・`app.options`・`app.head`
- [x] `QUERY` メソッド([RFC 10008](https://www.rfc-editor.org/rfc/rfc10008.html))
- [x] 標準ミドルウェア: CORS、静的ファイル、セキュリティヘッダー、ボディサイズ制限
- [x] Cloudflare Workers 対応(`export default app`、`c.env`、`c.executionCtx`)
- [x] [Standard Schema](https://standardschema.dev) によるバリデーション(Zod・Valibot・ArkType など)
- [x] `/healthz`・`/readyz` とグレースフルシャットダウン
- [x] 性能: 再現できるベンチマーク、高速なルーター(Map + Trie)、リクエストごとの負荷の削減
- [x] `c.ip`
- [x] 開発モードの `Server-Timing` ヘッダー(ブラウザの開発者ツールで玉ねぎが見える)
- [x] npm と JSR(どちらも `@senrijs/senri`)への公開

## 0.2.0 — 軽くして、ブラウザへ(2026-10-27 公開済み)

- [x] ブラウザ(Service Worker)対応
- [x] 開発機能の分離(`@senrijs/senri/dev` の `devtools()`)
- [x] 本体の軽量化(minify 後 約 14KB。Cookie と IP は別の入口へ)

## 0.2.1 / 0.2.2 — 公開後の修正

細かい内容は [CHANGELOG](./CHANGELOG.md) にあります。

- [x] すべての入口に JSDoc(JSR スコア 100%)
- [x] Release Please による自動リリース(バージョン・CHANGELOG・npm と JSR への公開)
- [x] Cookie の `__Host-` / `__Secure-` の扱い(消すときの `Secure`、`domain` と `path` の確認、大文字小文字を区別しない判定)
- [x] `serve()` の修正(Node.js の `hostname`、2回目のシグナルで即終了)
- [x] `bodyLimit` が `onError` の返り値によらず 413 を返す
- [x] 開発用ページが外部のフォントを読み込まない

## 0.2.x — 日常の開発で困らないように

- [ ] `NODE_ENV` が未設定のとき、開発用の出力は localhost へのリクエストだけにする
- [ ] `create-senri`(`npm create senri`)
- [ ] エラーメッセージと開発ページの日英対応
- [ ] レスポンスのヘルパー: `c.html()`、`c.redirect()`、`c.notFound()`
- [ ] SSE / ストリーミングのヘルパー(`c.stream()` など)
- [ ] ファイルアップロード: サイズ・種類の検証、大きなファイルのストリーム受信
- [ ] ミドルウェアの追加: Basic / Bearer 認証、圧縮、ETag、リクエスト ID、タイムアウト
- [ ] ミドルウェアの追加: メソッド上書き、末尾スラッシュの正規化、IP 制限、キャッシュ、言語判定、Pretty JSON
- [ ] 性能: 文字列を返すときの速い道、oha での HTTP のベンチマーク(ヘルパーのあと)

## 0.3.0 — 本番まで届く

- [ ] 型付きクライアント(RPC)
- [ ] OpenAPI の生成
- [ ] テスト用ヘルパー
- [ ] OpenTelemetry: 玉ねぎタイムラインが、そのまま本番のトレースに
- [ ] Prometheus メトリクス
- [ ] WebSocket
- [ ] JWT、CSRF 対策
- [ ] Context Storage(どこからでも `c` を取れる)
- [ ] API の整理: 意図せず公開されているもの(`parseCookies`・`serializeCookie`・`deletionCookie`・`resolvePort`・`DEFAULT_PORT`・`PortSource`・`isLocalUrl`)を隠し、公開の型が非公開の型を参照しないようにする
- [ ] `serveStatic` のシンボリックリンクへの対策(ファイルを開いたあとで、root の中かを確かめ直す)

## 0.4.0 — どこにでもデプロイ

- [ ] `senri build --target workers | docker | k8s`

## その先

- プロキシ、SSG、Cron(Workers の `scheduled` など)
- **Ippo** — Senri の上に乗る、React(のちに Vue)対応のメタフレームワーク
