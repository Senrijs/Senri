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

## 0.1.1

- [ ] エラーメッセージと開発ページの日英対応
- [ ] `create-senri`
- [ ] SSE / ストリーミングのヘルパー
- [ ] ミドルウェアの追加: Basic / Bearer 認証、圧縮、ETag、リクエスト ID、タイムアウト

## 0.2.0 — 本番まで届く

- [ ] 型付きクライアント
- [ ] OpenAPI の生成
- [ ] テスト用ヘルパー
- [ ] OpenTelemetry: 玉ねぎタイムラインが、そのまま本番のトレースに
- [ ] Prometheus メトリクス
- [ ] WebSocket
- [ ] JWT、CSRF 対策
- [ ] Context Storage(どこからでも `c` を取れる)

## 0.3.0 — どこにでもデプロイ

- [ ] `senri build --target workers | docker | k8s`

## その先

- プロキシ、SSG、Cron
- **Ippo** — Senri の上に乗る、React(のちに Vue)対応のメタフレームワーク