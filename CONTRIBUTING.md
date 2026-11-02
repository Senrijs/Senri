# Senri への貢献

Issue も Pull Request も歓迎です。ありがとうございます。

## はじめる

[Bun](https://bun.sh)・[Deno](https://deno.com)・[Node.js](https://nodejs.org)(22 以降)を入れてから:

```bash
bun install
bun test              # テスト(Bun)
bun run test:node     # Node アダプターとパッケージのテスト(Node)
bun run typecheck     # 型チェック(src / test / adapters / examples / Deno)
bun run smoke         # examples を Bun / Deno / Node / workerd で起動して、HTTP で確かめる
```

Pull Request の前に、この4つを通してください。CI でも同じものを動かします。

`ui/`(開発モードのエラーページとダッシュボード)を変えたときは、`bun run build:pages` で `src/dev/page.generated.ts` を作り直して、一緒にコミットしてください。

## 方針

- **どのランタイムでも同じに動くこと。** Web 標準の API だけで書きます。ランタイムごとの処理は `src/runtime.ts` と `adapters/` に閉じ込めます
- **本番の挙動と API を壊さないこと。** 変えるときは、Issue で先に相談してください
- **本番では、開発用の処理を一切動かさないこと。** 計測や記録は、`createApp({ dev: devtools() })`(`@senrijs/senri/dev`)で開発モードにしたときだけです
- **Cloudflare Workers で動かない書き方をしないこと。** `eval` や `new Function` は使いません
- 新しい機能やバグの修正には、テストを付けてください。型の振る舞いは `test/types.check.ts` で確かめます
- 依存は増やさない方針です。開発用の依存は、公開から2週間以上たったバージョンに固定します

## ベンチマーク

性能に関わる変更は、`bench/` で前後を比べてください(使い方は [bench/README.md](./bench/README.md))。数字は、計測した条件と一緒に書いてください。

## コミット

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) の形(`feat:`・`fix:`・`docs:` など)で、何をなぜ変えたかが分かるように書いてください。

Pull Request はスカッシュでマージするので、**PR のタイトルがそのまま main のコミットになります**。タイトルも同じ形にしてください(CI の「PR title」で確かめます)。CHANGELOG は英語なので、タイトルも英語で書きます。

## リリース

バージョンと CHANGELOG は [Release Please](https://github.com/googleapis/release-please) が決めます。`package.json` / `jsr.json` の `version` と `CHANGELOG.md` は、手で変えないでください。

このリポジトリには、パッケージが2つあります。

| パッケージ | 場所 | タグ | 公開先 |
| --- | --- | --- | --- |
| `@senrijs/senri` | ルート | `vx.y.z` | JSR と npm |
| `create-senri` | `packages/create-senri` | `create-senri-vx.y.z` | npm だけ |

1. main にマージされるたびに、Release Please がリリースの PR を作る・更新する(`fix:` と `feat:` はパッチ、破壊的変更(`feat!:` など)はマイナーが上がる。1.0 より前のあいだ)。PR はパッケージごとに別々で、両方に変更があると PR が2つできる
2. その PR をマージすると、そのパッケージのタグと GitHub Release ができ、同じワークフロー(`.github/workflows/publish.yml`)が公開する

リリースの PR を扱うときの注意です。

- PR が2つあるときは、1つずつマージする。1つ目をマージしたら、その公開の実行(Actions → Publish)が終わるのを待ってから、次をマージする。同時にマージすると、Release Please がどちらのパッケージのリリースかを取り違えることがある
- リリースの PR の本文は、手で編集しない。Release Please は、マージされた PR の本文を読んで、どのパッケージのどのバージョンかを判断する
- マージしたのにタグができないと、Publish の `check-release` が赤くなる。直し方は「[マージしたのにタグができないとき](#マージしたのにタグができないとき)」

`create-senri` のテンプレートが入れる `@senrijs/senri` の範囲は、`packages/create-senri/version.js` にあります。本体のバージョンがこの範囲の外に出ると(0.2.x → 0.3.0 など)、CI の `create-senri-range`(`bun run test:range`)が赤くなります。これが、テンプレートを新しい API に追従させる合図です。0.3.0 などが出たら、テンプレートを直して範囲を上げる PR を出してください。公開のワークフローはこのテストを走らせないので、公開は止まりません(公開済みの `create-senri` は、これまでの範囲で動き続けます)。

タグを手で push しても公開はされません。

### 手で公開し直す

公開が途中で失敗したときなどは、作り済みのタグを手で公開し直せます。公開済みのもの(JSR・npm それぞれ)は飛ばすので、何度動かしても大丈夫です。

1. GitHub の Actions → Publish → Run workflow を開く
2. ブランチは main のまま、`tag` に公開するタグ(例: `v0.2.1`、`create-senri-v0.1.0`)を入れて実行する

GitHub CLI なら `gh workflow run publish.yml -f tag=v0.2.1` です。そのタグの `package.json` / `jsr.json` の `version` がタグと違うときは、公開せずに失敗します。

### マージしたのにタグができないとき

リリースの PR をマージしたのに、Release Please がタグと GitHub Release を作れないことがあります。そのときは Publish の `check-release` が赤くなり、PR のラベルが `autorelease: pending` のまま残ります。このラベルが残っているあいだ、Release Please は新しいリリースの PR も作りません。手で次のように直します(例は #32、`@senrijs/senri` の 0.2.5)。

1. タグと GitHub Release を作る。場所は、その PR のマージコミット。名前は `@senrijs/senri` なら `v0.2.5`、`create-senri` なら `create-senri: v0.1.1` の形。本文(下の例の `notes.md`)は、そのバージョンの CHANGELOG の項目を写したもの

   ```sh
   sha=$(gh pr view 32 --json mergeCommit -q .mergeCommit.oid)
   gh release create v0.2.5 --target "$sha" --title v0.2.5 --notes-file notes.md
   ```

2. PR のラベルを `autorelease: pending` から `autorelease: tagged` に付け替える。`gh pr edit` は GraphQL のエラーで失敗することがあるので、ブラウザ(PR の右側の Labels)か、REST API を使う

   ```sh
   gh api -X DELETE "repos/Senrijs/Senri/issues/32/labels/autorelease:%20pending"
   gh api -X POST repos/Senrijs/Senri/issues/32/labels -f "labels[]=autorelease: tagged"
   ```

3. 「[手で公開し直す](#手で公開し直す)」の手順で、そのタグを公開する(`gh workflow run publish.yml -f tag=v0.2.5`)

### 新しいパッケージを npm に初めて出す

npm の Trusted Publisher(GitHub Actions からの公開)は、パッケージが npm にないと設定できません。なので最初のバージョンだけは、手で公開します(`create-senri` の 0.1.0 がこれにあたります)。

1. Release Please が作ったリリースの PR のブランチを手元に取り、そのパッケージのフォルダで `npm publish --access public` を実行する
2. リリースの PR をマージする。npm には公開済みなので、ワークフローは npm を飛ばし、タグと Release だけ作る(Trusted Publisher はまだ作らない)
3. `release-please-config.json` のそのパッケージから `release-as` を外す PR を出す(外さないと、次のリリースも同じバージョンになる)
4. そのパッケージに次の `fix:` / `feat:` が入ってリリースの PR ができたら、マージする直前に、npmjs.com のパッケージの設定で Trusted Publisher を作る(Organization: `Senrijs`、Repository: `Senri`、Workflow: `publish.yml`、Allowed actions は `npm publish` にチェック)。そのマージで動く自動の公開で、設定が検証される

Trusted Publisher は、作ってから2日以内に公開に使われないと失効します。手で出した最初のバージョンは設定を使わないので、先に作ると次のリリースまでに切れてしまいます。また、2026-09-03 以降に作った設定で自動で許可されるのは `npm stage publish` だけで、ワークフローが使う `npm publish` は、Allowed actions でチェックを入れないと失敗します([npm のドキュメント](https://docs.npmjs.com/trusted-publishers))。

## ライセンス

コードへの貢献は [MIT ライセンス](./LICENSE) で公開されます。ロゴ(`.github/assets/`)は MIT ライセンスの対象外です。
