# docs/website

Senri のドキュメントサイト(https://senri.skyia.jp)。[Fumadocs](https://fumadocs.dev)(Next.js)で作り、静的なファイルに書き出して Cloudflare Workers の静的アセットとして配信します。

本体(`@senrijs/senri`)とは別の、独立したパッケージです。npm / JSR には公開せず(`"private": true`)、Release Please の対象にもしません(`release-please-config.json` の `exclude-paths`)。

## 動かし方

```sh
cd docs/website
bun install
bun run dev       # 開発サーバー(http://localhost:3000)
bun run build     # out/ に書き出す
bun run preview   # out/ を配信して確かめる
```

`../../node_modules/.bin/wrangler dev` を使うと、Cloudflare と同じ配信(`wrangler.jsonc`)で確かめられます(リポジトリのルートで `bun install` してあるとき)。

## URL

| URL | 中身 |
| --- | --- |
| `/`、`/en/` | トップページ(日本語、英語) |
| `/docs/`、`/en/docs/` | ドキュメント(`content/docs/ja`、`content/docs/en`) |
| `/blog/`、`/en/blog/` | ブログ(`content/blog/ja`、`content/blog/en`) |
| `/llms.txt`、`/llms-full.txt`、`/en/llms.txt`、`/en/llms-full.txt` | LLM 向けの目次と全文 |
| `/llms.mdx/<言語>/docs/<ページ>/content.md` | ページごとの Markdown(「Markdown でコピー」が読む) |
| `/og/<言語>/docs/<ページ>/image.png` | ページごとの OG 画像 |
| `/api/search` | 検索の索引(検索はブラウザの中で行う) |

- 静的書き出しでは middleware が動かないので、言語ごとにルートのファイルを置いています(`app/(ja)` と `app/(en)/en`)。中身は `components/pages` の共通の部品です。
- `/docs/routing.md` のような短い Markdown の URL は、Next.js の rewrites が静的書き出しで使えないので作っていません。

## 書くときに使えるもの

`content/docs/ja/samples.mdx` に、全部の見本があります。

- ` ```ts twoslash `: 型のヒント。`@senrijs/senri` の型は、リポジトリの `src` / `adapters` から読みます(`lib/senri-types.ts`)。型エラーがあるとビルドが失敗します
- `<AutoTypeTable path="../../src/multipart.ts" name="MultipartLimits" />`: TypeScript の型から表を作ります。説明は JSDoc から取ります
- ` ```npm `: npm / pnpm / yarn / bun / deno のタブ。Deno では `@senrijs/senri` を JSR から入れます(`lib/deno.ts`)
- ` ```mermaid `: 図
- `<Files>` / `<Folder>` / `<File>`、`<Steps>` / `<Step>`、`<Callout>`、`<Tabs>` / `<Tab>`

## ブログ

記事はまだありません。Next.js の静的書き出しは、記事が 0 件だと `[slug]` のルートでビルドが止まるので、記事のページは `app/(ja)/(home)/blog/_[slug]` と `app/(en)/en/(home)/blog/_[slug]` に置いています(`_` で始まるフォルダーはルートになりません)。最初の記事を足すときに、`_[slug]` を `[slug]` に名前を変えてください。

記事の frontmatter: `title`、`description`、`date`(例: `2026-12-01`)、`author`(省略可)。

## 配信(Cloudflare Workers Builds)

Cloudflare の Workers & Pages で、このリポジトリを接続して設定します。

| 項目 | 値 |
| --- | --- |
| ルートのディレクトリ | `docs/website` |
| ビルドのコマンド | `bun install --frozen-lockfile && bun run build` |
| 配信のコマンド | `npx wrangler deploy` |
| 本番のブランチ | `main` |
| 独自ドメイン | `senri.skyia.jp`(Custom Domains) |

GitHub の Actions(`.github/workflows/website.yml`)は、ビルドが通るかを確かめるだけで、配信はしません。
