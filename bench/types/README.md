# 型チェックの時間

ルートが多いアプリの型チェックの時間を、Senri の版どうしで比べます(#160・#161)。依存は増やしません。リポジトリの直下の `tsc`(`node_modules/.bin`)を使います。

```sh
# リポジトリの直下で
bun bench/types/run.ts plain@origin/main chain@.
bun bench/types/run.ts --routes 200,500,2000 --runs 11 chain@origin/main scoped@.
```

- `<書き方>@<ref>` を並べます。`<ref>` は git の ref か、`.`(いまの作業中のフォルダーの `src`)です。ref の `src` は `bench/types/out/` に写します
- 渡した組み合わせを交互に `tsc --extendedDiagnostics --singleThreaded` で型チェックし、Check time の最小と中央値、型のインスタンス化の数、型エラーの数を表にします
- 作ったアプリと写した `src` は `bench/types/out/` に残ります(`.gitignore` の `out`)。中身を見たいときは、`bench/types/out/<組み合わせ>/app.ts` を開きます

## 書き方(`gen.ts`)

どれも、全体の `use` が 5 つ、パス付きの `use` が 5 つのアプリです。ルートは 7 種類の前置きに順に置き、3 つに 1 つはルートの `use` も付けます。

| 書き方 | アプリ | 全体の変数 | パスの下の変数 |
|---|---|---|---|
| `plain` | `createApp<Vars>()` と、つながない `app.use()` | `c.get("user")?.name` | `c.get("admin")!` |
| `chain` | `createApp<Vars>().use(...)` とつなげる(#160) | `c.get("user").name` | `c.get("admin")!` |
| `scoped` | パス付きの `use` もつなげる(#161 の案 B) | `c.get("user").name` | `c.get("admin")` |

`scoped` は、パス付きの `use` の型がない版では型エラーになります(表の「型エラー」に数が出ます)。

## 測り方の注意

- 時間は、ほかの作業で機械が混んでいるとばらつきます(同じものでも 2 倍ほど)。同じ回に交互に測って、最小と中央値を見ます。インスタンス化の数は何回測っても同じなので、こちらのほうが比べやすいです
- 版の違いを見るときは、同じ `<書き方>` どうしか、その版で正しい書き方どうし(`plain@origin/main` と `chain@.` など)を比べます

## #160 の調査での値

2026-11 に、TypeScript 7.0.2 で測りました。表の値は「インスタンス化の数(時間の中央値)」です。

| ルート数 | 0.4(`plain`) | #160 の案 A(`chain`) | 案 B の試作(`scoped`) |
|---|---|---|---|
| 200 | 45.0k(0.23s) | 50.4k(0.23s) | 113k(0.38s) |
| 500 | 88.5k(0.55s) | 99.9k(0.46s) | 244k(1.05s) |
| 2,000 | 306k(2.2s) | 347k(2.2s) | 902k(4.7s) |

## 案 B の試作(`scoped-prototype.patch`)

パス付きの `use` も型に乗せる試作の差分です(#161 で使います。要点は #161 の Issue に書きました)。`src/app.ts` だけを変えます。#160 より前の main(`d202ca4`)に当たります。今の main には、そのままでは当たりません。

```sh
git switch -c try/scoped d202ca4
git apply bench/types/scoped-prototype.patch
bun bench/types/run.ts scoped@. plain@.
```
