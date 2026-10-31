# ロードマップ

> 千里の道も一歩から。

Senri がこれから向かう先です。バージョンは目標であって日付の約束ではなく、フィードバックに応じて変わることがあります。
アイデアや要望は [Issues](https://github.com/Senrijs/Senri/issues) にお気軽にどうぞ。

[English](./ROADMAP.md) · **日本語**

## できていること

- Web 標準(`Request` → `Response`)のコアが **Bun・Deno・Node.js** で動く
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

## 0.2.0 — 軽くして、ブラウザへ(完了)

- [x] ブラウザ(Service Worker)対応
- [x] 開発機能の分離(`@senrijs/senri/dev` の `devtools()`)
- [x] 本体の軽量化(minify 後 約 14KB。Cookie と IP は別の入口へ)

## 0.2.1 / 0.2.2 — 公開後の手直し(公開済み)

細かい変更は [CHANGELOG](./CHANGELOG.md) にあります。

- [x] 公開しているすべての API に英語のドキュメント(JSR のスコアのため)
- [x] Release Please による、バージョン・CHANGELOG・公開の自動化
- [x] Cookie の `__Host-` / `__Secure-` の扱い: 消すときも Secure を付ける、`__Host-` の domain と path を確かめる、接頭辞の大文字小文字を区別しない
- [x] `serve()` の修正: Node.js でも `hostname` を使う、止まっている途中の2回目のシグナルですぐに終わる。`bodyLimit` は `onError` が何を返しても 413
- [x] 開発用のページが外のフォント(Google Fonts)を読み込まない

## 0.2.x — 日常の開発で困らないように

- [ ] エラーメッセージと開発ページの日英対応
- [ ] `create-senri`
- [ ] SSE / ストリーミングのヘルパー
- [ ] レスポンスのヘルパー
- [ ] ファイルアップロード
- [ ] ミドルウェアの追加: Basic / Bearer 認証、圧縮、ETag、リクエスト ID、タイムアウト
- [ ] 性能: 文字列を返すときの速い道、oha での HTTP のベンチマーク(ヘルパーのあとに)

## 0.3.0 — 本番まで届く

- [ ] API の整理: 意図せず公開されているもの(`parseCookies`・`serializeCookie`・`deletionCookie`・`resolvePort`・`DEFAULT_PORT`・`PortSource`・`isLocalUrl`)を隠す。`deno doc --lint` の `private-type-ref`(19 件)をなくす
- [ ] `serveStatic` のシンボリックリンクへの対策(ファイルを開いたあとで、root の中かを確かめ直す)
- [ ] 型付きクライアント
- [ ] OpenAPI の生成
- [ ] テスト用ヘルパー
- [ ] OpenTelemetry: 玉ねぎタイムラインが、そのまま本番のトレースに
- [ ] Prometheus メトリクス
- [ ] WebSocket
- [ ] JWT、CSRF 対策
- [ ] Context Storage(どこからでも `c` を取れる)

## 0.4.0 — どこにでもデプロイ

- [ ] `senri build --target workers | docker | k8s`

## その先

- プロキシ、SSG、Cron
- **Ippo** — Senri の上に乗る、React(のちに Vue)対応のメタフレームワーク