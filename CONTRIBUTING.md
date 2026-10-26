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
- **本番では、開発用の処理を一切動かさないこと。** 計測や記録は `dev: true` のときだけです
- **Cloudflare Workers で動かない書き方をしないこと。** `eval` や `new Function` は使いません
- 新しい機能やバグの修正には、テストを付けてください。型の振る舞いは `test/types.check.ts` で確かめます
- 依存は増やさない方針です。開発用の依存は、公開から2週間以上たったバージョンに固定します

## ベンチマーク

性能に関わる変更は、`bench/` で前後を比べてください(使い方は [bench/README.md](./bench/README.md))。数字は、計測した条件と一緒に書いてください。

## コミット

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) の形(`feat:`・`fix:`・`docs:` など)で、何をなぜ変えたかが分かるように書いてください。

## ライセンス

コードへの貢献は [MIT ライセンス](./LICENSE) で公開されます。ロゴ(`.github/assets/`)は MIT ライセンスの対象外です。
