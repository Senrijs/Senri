# senri

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To type check:

```bash
bun check
```

This project was created using `bun init` in bun v1.4.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## パスのルール

- 末尾スラッシュと連続スラッシュは無視します。`/users`、`/users/`、`//users` はどれも同じパスです。
- パスはセグメント(`/` の間)ごとにパーセントデコードされます。`/こんにちは` のようにそのまま書いたルートにマッチし、パスパラメーターもデコード済みの値で届きます。
- デコードできないパス(`%E0%A4%A` など)と、`%2F`(エンコードされた `/`)を含むパスは 400 になります。
- 正規化・デコード済みのパスは `c.path` で読めます。パスで判定するミドルウェアは `req.url` ではなく `c.path` か `app.use("/admin", mw)` を使ってください。
- 同じメソッド + 同じパス(パラメーター名だけ違うものも含む)を2回登録するとエラーになります。
