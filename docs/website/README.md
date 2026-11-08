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

## トップページ

`components/home/` にあります。見本は `docs/design/top-page.dc.html` です。

- **文言:** `lib/home/dict.ts`(日本語と英語)。バッジの説明(`badgeVersion` と `badge`)は、リリースのたびに書き換えます。バージョンが合わないときは「vX.Y.Z リリース」とだけ出ます
- **ビルドのときに作るデータ:** `bun run dev` と `bun run build` は、先に `scripts/home-data.ts` を動かして `lib/home/generated.json`(Git には入れない)を作ります
  - CLI のログとプレイグラウンドの結果: リポジトリの本物の `logger()`、`showRoutes()`、開発モードで動かした出力
  - バージョン: リポジトリの `package.json`
  - GitHub のスター数と npm の週間ダウンロード数: トークンなしの API。取れなければ数字を出しません
- **数字(16 KB とテストの件数):** `components/home/home-page.tsx` に直接書いています。リリースのときに `bun run size` と `bun test` で見直します
- **動き:** 動きを減らす設定と、フッターの「動きを止める」(`<html data-motion="off">`)で止まります
  - [Motion](https://motion.dev) は `LazyMotion` と `domAnimation` だけを使い、`m.*` の部品で書きます(`components/home/motion-root.tsx`)。`domAnimation` は描いたあとで読み込みます
  - `motion/react` から `useSpring` などのフックを取り込むと、Motion の動きの仕組みが最初に読む JavaScript に入るので使いません
  - Motion Primitives(MIT)から元にした部品は、ファイルの先頭に出どころを書いています
  - ヒーローの見出しは、JavaScript を待たずに出るように CSS だけで動かします
  - 特長のカードのダイアログは Web Animations API で動かします(`components/home/expand-dialog.tsx`)
- **リンクの先読み:** `bun run build` の最後に `scripts/flatten-segments.ts` が動きます。Next.js が入れ子のフォルダーに書いた先読みのファイルを、ブラウザが読みに来る名前(`/` を `.` にしたもの)でも置きます
- **ロゴ:** `public/brand/` は https://github.com/Senrijs/brand の SVG のコピーです

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
