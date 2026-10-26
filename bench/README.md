# ベンチマーク

Senri・Hono・Elysia を同じ条件で比べます。依存はこのディレクトリの中だけで、バージョンは `package.json` で固定しています。

```sh
cd bench
bun install
bun run router   # ルーターだけ(Request も Response も作らない)
bun run fetch    # app.fetch をプロセスの中で直接呼ぶ(ネットワークなし)
bun run http     # サーバーを立てて oha で負荷をかける
```

## 条件

- どのフレームワークも本番モード、ミドルウェアなし、ハンドラーはテキストを返すだけ
- ルートは 12 個、リクエストは 8 種類(`apps.ts`)。最初に、全部のフレームワークが同じ status を返すことを確かめてから測ります
- `http` は、どのフレームワークも同じ `Bun.serve({ fetch })` で動かします(Elysia の `listen()` や Bun の `routes` は使いません)
  - [oha](https://github.com/hatoo/oha) が必要です。PATH にないときは、環境変数 `OHA` に実行ファイルのパスを入れます
  - サーバーを全部先に立てておき、同じリクエストを順番を変えながら交互に測って、中央値を出します
  - `DURATION`(既定 `10s`)・`CONNECTIONS`(既定 `64`)・`ROUNDS`(既定 `3`)・`FRAMEWORKS` で条件を変えられます
  - 負荷をかける側とサーバーが同じマシンで動くので、CPU のコア数が少ないと数字がぶれます

## 読み方の注意

- Senri はテキストを返すとき、どのランタイムでも同じになるよう `Content-Type: text/plain; charset=utf-8` を自分で付けます。Hono と Elysia はランタイムに任せる(`new Response(text)`)ので、そのぶん Senri が不利です
- Elysia は登録したルートからコードを生成して最適化します(`compile()`)。Senri は Cloudflare Workers でも動くよう、`new Function` / `eval` を使いません
