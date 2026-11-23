# 本体の大きさと速さの調査(0.4)

> 状態: 調査だけです(src は変えていません)。どれを入れるかは、この結果と VM の結果を見て決めます。
> Issue: #146

本体(`bun run size` の最小アプリ)に何が入っているかを関数ごとに洗い出し、削る候補と速くする候補を、測った数字つきで並べます。大きさと速さは取り合いになるので、1 つのメモで比べます。

前提:

- **測って差が出ないものは入れません。** 数字のないものは勧めません
- グローバルの `Request` / `Response` を書き換える方法は、候補に入れません
- ベンチの 1 位は狙いません。「汎用的でちょっと速い」を目指します
- 大きさの上限は、`bun run size` の最小アプリ(`app.get("/", () => "hi")`)を bun build で minify した gzip 後で **8,192 B** です。調べた時点(origin/main 0675d2f)は **7,683 B** で、残りは **509 B** です

---

## 1. 結論

- **いちばん大きく削れるのは X2(Node のアダプターだけが使うコードを Context の外に出す)で、-192 B です。** 挙動も型も公開 API も変わりません。Node の近道の速さも、手元では差が見えませんでした(5.2)
- `createApp({ dev: true })` の案内を短くする(X1、-34 B)か、確かめごと消す(X1b、-122 B)と、さらに削れます。0.2.0 で使えなくなった書き方の案内です
- 書き方を詰めるだけの小さな候補(X3・X4・X5)は、-10 B〜+6 B でした。gzip がもう繰り返しを縮めているので、ほとんど効きません
- **速くする候補では、E2(`c.header()` のあとに Response を作り直さない)がはっきり効きました。** ミドルウェアを積んだ場合(mw)に、手元で Bun 約 1.3 倍・Deno 約 1.9 倍・Node 1.08〜1.16 倍です。大きさは +26 B です。前に試した版(+138 B)とは作りを変えて、挙動が変わらないようにしました(6.2)
- E1(`splitPath` を 1 回の走査にする)は、パスの値つき(param)で 5〜18% 速い向きでしたが、回によってはぶれの中でした。+61 B です。**VM で差が見えたら入れる**候補にします(6.1)
- 組み合わせの案は 3 つです(7 章)。勧めるのは **案 2(X2 + X1 + X5 で削り、E2 を入れる。7,474 B、-209 B)** です。E1 は VM の結果しだいで足します(案 3)
- E2 と X2 は src/context.ts を触るので、もう一つのセッションの案 D(#176、c.json・c.text の型)を取り込んでから作ります(9 章)

---

## 2. 測り方

### 2.1 大きさ

- 数字はすべて `bun scripts/size.ts --check <写し>` の値です(CI の size ジョブと同じ。hi のアプリ、bun build・minify・gzip -9)
- 候補ごとに、src の写しをリポジトリの外に作り、そこだけを書き換えて測りました。写しには `package.json` も置いています(`"sideEffects": false` がないと、使わないモジュールの中身が残り、7,807 B と大きく出ます)
- 組み合わせは、候補ごとの差分を順に当てて、改めて測りました。差は足し算になりません(gzip の都合)

関数ごとの大きさ(3 章)は、次のやり方で出しました。

- 最小アプリを minify なしで 1 ファイルにまとめたもの(36,932 B)から、宣言を 1 つずつ抜き、Bun.build(minify)でまとめ直して、gzip 後の差を見ました
- 抜いた宣言からしか使われないものも一緒に消えるので、「その宣言のために入っている大きさ」です。足し合わせても全体にはなりません
- 小さい宣言(数 B)は、gzip の都合で負になることがあります。目安として見てください

### 2.2 速さ

手元は Windows 11(Intel N100、Bun 1.4.4・Node.js 24.11.0・Deno 2.9.8)です。wrk がなく、ぶれも大きいので、**手元の数字は割合と、案どうしの差を見るためだけ**に使います。HTTP の数字は VM で取ってもらいます(8 章)。

- **マイクロベンチ:** プロセスの中で `app.fetch` を呼び続け、本文も読みます。案(写し)をラウンドごとに順番を変えて交互に測り、1 回あたりの時間(ns)の中央値を比べます。21 ラウンド × 300 ms を、同じ組み合わせで 2 回以上取りました
- **プロファイル:** 同じ回し方で 5 秒(Bun は `--cpu-prof`、Node と Deno は `node:inspector`)取り、[`bench/perf-profile-summary.ts`](../../bench/perf-profile-summary.ts) でまとめました。サンプリングは 1 ms おきで、割合は数 % ぶれます
- Node.js の数字は `app.fetch` の道のものです。`@senrijs/senri/node` の近道(Request も Response も作らない道)は通りません。近道に関わるもの(X2)は、その部分だけを切り出して測りました

使い方は 4 つです。bench の 3 つ(static / param / mw)に、JSON を返すものを足しました。

| 使い方 | 中身 |
|---|---|
| text | `GET /` で `"hi"` を返す |
| json | `GET /json` で `{ ok: true, n: 1 }` を返す |
| param | `GET /users/42` で `{ id }` を返す(`/users/:id`) |
| mw | param に、requestId + cors + `c.header()` で 1 つ足す自前のもの、の 3 つを積む |

---

## 3. 最小アプリの中身

ファイルごと(`bun run size` の内訳。esbuild で minify した、gzip 前のバイト):

| ファイル | バイト |
|---|---:|
| src/app.ts | 5,424 |
| src/context.ts | 4,618 |
| src/router.ts | 2,140 |
| src/errors.ts | 1,618 |
| src/validate.ts | 1,198 |
| src/matcher.ts | 1,102 |
| src/compose.ts | 779 |
| src/body.ts | 708 |
| src/body-cap.ts | 673 |
| src/plain.ts | 280 |
| src/routes.ts | 237 |
| src/group.ts | 192 |
| src/connection.ts | 174 |

まとまりごと(抜いたときの gzip 後の差。2.1 のやり方):

| まとまり | 主な関数 | gzip 後 |
|---|---|---:|
| `Context` のクラス全体 | 下の内訳 | 2,009 B |
| ├ `toResponse` | 戻り値を Response にする | 197 B |
| ├ `body()` | 本文を読む(`readBody`・`formToObject` など) | 211 B |
| ├ `redirect()` | `toLocation` を含む | 190 B |
| ├ static ブロック | **Node 専用の `plainOf`(116 B)・`lazyContext`(20 B)**、`connectionOf`(16 B) | 168 B |
| ├ `finalize()` | `c.header()` のヘッダーを足す | 112 B |
| ├ `LazyContext`(context.ts の、`Context` の外) | **Node 専用** | 75 B |
| ├ `segments` / `path` | パスの分割と正規化 | 76 B / 65 B |
| └ `bodyBytes()` / `env` / `executionCtx` / `valid()` | | 73 / 67 / 63 / 43 B |
| `app.fetch` | 入口 | 500 B |
| ルートの表(`createMatcher`) | `seek`・`walk` など | 395 B |
| ルートの登録(`add`) | `checkPathSyntax` 105 B・`normalizeMethod` 82 B・`checkParamNames` 59 B など | 392 B |
| `inner` | ルートの種類ごとに分ける。QUERY の確かめ(`checkQueryRequest` 152 B)を含む | 328 B |
| `compose` | ミドルウェアをつなぐ | 321 B |
| 本文の上限(`capRequest`) | `capBody` 151 B を含む | 288 B |
| `resolve` | ルートを探す | 278 B |
| スキーマで確かめる(`routeHandler`) | `withValidation`・`readParams`・`ValidationError` など | 451 B |
| `app.routes()` / `app.route()` / `app.use()` / `app.on()` | | 225 / 180 / 112 / 83 B |
| `pathnameOf` / `splitPath` | URL からパスを取り出す / 分ける | 157 / 56 B |
| `handleError` | | 105 B |
| `createApp({ dev: true })` の案内文 | `DEV_TRUE` | 96 B |

読み方:

- 最小アプリでも、`createApp()` が持つ機能(スキーマ、`app.routes()`、`app.route()`、QUERY、`c.redirect()`、`c.body()`)はすべて入ります。`app` のプロパティや `Context` のメソッドは、使わなくても木の枝刈りで落ちないためです
- その中で、**Node のアダプターからしか使わないもの**(`plainOf`・`lazyContext`・`LazyContext`。合わせて約 210 B)は、置き場所を変えるだけで落とせます(X2)。`Context` の static ブロックの中にあるので、今は `Context` を使うだけで入っています
- 機能そのものを外に出す(別の入口にする)と、上の表の分だけ減りますが、どれも公開 API が変わる壊れる変更です(5.3)

---

## 4. 時間を使っているところ

プロセスの中のプロファイル(今の src)。「Senri」は src の関数の self の合計、「上位」は Senri の関数の self の上位です。

| ランタイム | 使い方 | Senri | ランタイム(Response など) | Senri の上位(self) |
|---|---|---:|---:|---|
| Bun | text | 39% | 61% | `fetch` 13.3%・`resolve` 7.1%・`pathnameOf` 4.5%・`Context` 3.3%・`path` 3.0%・`capRequest` 2.6%・`methodOf` 2.2% |
| Bun | json | 44% | 56% | `pathnameOf` 8.0%・`staticLeaf` 7.7%・`fetch` 7.6%・`path` 7.0%・`resolve` 5.7% |
| Bun | param | 56% | 44% | `seek` 9.9%・**`splitPath` 8.0%**・`pathnameOf` 7.1%・`first` 5.7%・`fetch` 5.3% |
| Bun | mw | 48% | 52% | **`finalize` 12.3%(total 34.5%)**・`splitPath` 4.9%・`dispatch` 4.5%・`step` 4.2% |
| Node.js | text | 6% | 76%(GC 9%) | `inner` 1.5%・`fetch` 1.4% |
| Node.js | json | 13% | 80% | `json` 3.7%・`fetch` 1.5%・`toResponse` 1.5% |
| Node.js | param | 22% | 72% | **`splitPath` 4.0%**・`json` 3.4%・`resolve` 2.5%・`path` 2.5% |
| Node.js | mw | 21% | 71% | `step` 3.3%・`json` 2.7%・`splitPath` 2.4%・**`finalize` 1.2%(total 16.3%)** |
| Deno | text | 43% | 40%(GC 17%) | `fetch` 13.7%・`path` 12.9%・`callHandler` 11.0%・`resolve` 5.1% |
| Deno | json | 46% | 47% | `callHandler` 19.4%・`resolve` 10.0%・`path` 9.5%・`fetch` 6.0% |
| Deno | param | 57% | 38% | **`splitPath` 16.6%**・`callHandler` 13.7%・`resolve` 8.1%・`path` 8.1% |
| Deno | mw | 28% | 67% | `segments` 4.9%・`resolve` 3.8%・`callHandler` 3.5%・`end` 2.7%(total 49.4%) |

読み方:

- **ミドルウェアを積むと、`finalize`(Response の作り直し)がいちばん重いです。** Bun では total 34.5% です。ランタイム側の `forEach` 7.7%・`set` 7.6%・`Headers` 3.2% も、多くはここ(ヘッダーの写しと足し込み)から来ています。Deno の mw でも、ランタイム側の上位は `op_http_new_response_native_headers` 10.1%・Headers の `set` 6.6%・`forEach` 5.1% です。これが E2 の根拠です
- **パスの値つきでは `splitPath` が目立ちます**(Bun 8.0%・Deno 16.6%・Node 4.0%)。これが E1 の根拠です
- text と json は、時間の半分以上がランタイムの `Response` と `JSON.stringify` です。Senri の側で目立つのは `fetch`・`resolve`・`path` で、どれも 1 つずつは小さく、直す候補にできるものは見つかりませんでした
- Deno の `path` が重いのは、Host の確かめ(`req.headers.get("host")`)を含むためです。外すとパスのすり替えを許すので、直しません(perf-0.3 の 6.7)
- Node.js の `app.fetch` の道は、時間のほとんどが undici の `Response` と Web Streams です。Senri の割合は小さく、本番の Node はアダプターの近道を通るので、ここは直す対象にしません

---

## 5. 削る候補

| # | 何をするか | 大きさ | 挙動・型・公開 API | 速さ | テスト |
|---|---|---:|---|---|---|
| **X2** | Node 専用の `plainOf`・`lazyContext`・`LazyContext` を `src/lazy-context.ts` に出す | **-192 B** | 変わらない | Node の近道で差が見えず(5.2) | bun test・Node のテスト・型検査とも通る |
| X1b | `createApp({ dev: true })` の確かめと案内文を消す | -122 B | JS から `dev: true` を渡すと、案内の代わりに TypeError(`install` が関数でない)で落ちる。型では前から渡せない | なし(作るときだけ) | 案内文を見るテスト 1 つを消す |
| X1 | 同じ案内を 1 行に縮める | -34 B | 案内文が変わる(`code` の `dev_true` は同じ) | なし | 案内文を見るテスト 1 つを直す |
| X5 | CONNECT / TRACE / TRACK の 2 か所の確かめを、1 つの Set にまとめる | -10 B | 変わらない | リクエストの道は変わらない(ルートを登録するときの比べ方だけが変わる) | 通る |
| X4 | `c.json()` / `c.text()` / `c.html()` の中身を 1 つの関数にまとめる | -4 B | 変わらない | 見ていない | — |
| X3 | `new HttpError(400, "400 Bad Request")`(6 か所)を 1 つの関数にまとめる | +6 B | 変わらない | — | — |

X3 と X4 は差がない(か増える)ので、入れません。X5 は小さいですが、測って減り、挙動も変わらないので、案に入れます。

### 5.1 X2: Node 専用のコードを Context の外に出す

- **何をするか:** `Context` の static ブロックで作っている `lazyContext` と `plainOf`、そのあとにある `LazyContext` を、新しい `src/lazy-context.ts` に移します。`@senrijs/senri/node` はそこから読みます。private フィールド(`#status`・`#headers`・`#pathname`)には、static ブロックに残した小さな関数(`nodeState`)を通して触ります
- **根拠:** 最小アプリは Node のアダプターを読まないのに、`Context` を使うだけでこれらが入っています(3 章)
- **大きさ:** -192 B(7,683 → 7,491 B)
- **壊れる心配:** 小。どれも公開していない内部の関数です(`index.ts` から出していません)。`@senrijs/senri/node` の import を 1 行変えます
- **差分:** [`size-0.4/x2.diff`](size-0.4/x2.diff)

### 5.2 X2 の Node の近道の速さ

`plainOf` が private フィールドを直接読む代わりに `nodeState()` を呼び、`[status, headers]` の配列を作るようになるので、近道が遅くならないかを、その部分(`lazyContext` + `plainOf` を 30 万回、半分は `c.header()` つき)だけ切り出して交互に測りました(Node.js 24.11.0、9 ラウンドの中央値)。

| 回 | base | X2 | base ÷ X2 |
|---|---:|---:|---:|
| 1 | 1,588 ns(1,296–1,824) | 1,773 ns(1,298–2,209) | 0.896 |
| 2 | 1,394 ns(1,105–1,715) | 1,344 ns(999–1,613) | 1.037 |

向きがそろわず、幅も重なっているので、**差は見えません**。HTTP 経由では、この部分の割合はさらに小さくなります。念のため VM で Node の static / param を確かめてもらいます(8 章)。

### 5.3 X1 / X1b: `createApp({ dev: true })` の案内

- `dev: true` は 0.2.0(#10)で使えなくなり、今は書き方を案内するエラーを投げています。案内文は 5 行あり、96 B です
- X1 は、1 行(`Use createApp({ dev: devtools() }) with devtools from "@senrijs/senri/dev"`)に縮めます。-34 B です
- X1b は、確かめごと消します。-122 B です。TypeScript では前から `dev: true` を渡せないので、困るのは JS から古い書き方をした人だけです。そのときも黙って動くことはなく、`createApp()` の時点で落ちます
- どちらにするかは好みです。0.2.0 は今(0.4.0)から 2 つ前の minor 版なので、X1b でもよいと考えます

### 5.4 機能を外に出す(参考。勧めません)

機能そのものを本体から外すと、3 章の表の分だけ減ります。どれも公開 API が変わる壊れる変更で、「`createApp()` だけで使える」という今の形をやめることになるので、勧めません。数字は「抜いたときの差」(2.1)で、外に出す作りにしたときの値ではありません。

| 機能 | 抜いたときの差(gzip 後) |
|---|---:|
| ルートのスキーマ(`app.get(path, { params, query, body }, handler)`) | 451 B |
| `app.routes()`(`defineRoutes` の表) | 225 B |
| `c.body()` | 211 B |
| `c.redirect()` | 190 B |
| `app.route()`(マウント) | 180 B |
| QUERY メソッドの確かめ | 152 B |

---

## 6. 速くする候補

速さは、すべてプロセスの中の `app.fetch` の時間の比(base ÷ 案。1 より大きければ速い)です。HTTP では 1 リクエストのうち Senri の割合が小さくなるので、上がる幅はこれより小さくなる見込みです。

| # | 何をするか | 効く使い方 | 手元で速くなった幅 | 大きさ | 挙動・型・公開 API |
|---|---|---|---|---:|---|
| **E2** | json / text / html で作った Response には、`finalize` でヘッダーを直接足す(作り直さない) | `c.header()` を使うミドルウェアがあるとき | **mw: Bun ×1.29〜1.30、Deno ×1.94、Node ×1.08〜1.16**。text・json は ±5% の中 | **+26 B** | 変わらない |
| E1 | `splitPath` を、`split("/")` を使わない 1 回の走査にする | パスの値つきのルート | param: Bun ×1.05〜1.15、Deno ×1.12〜1.18、Node ×1.07〜1.08。前の回ではぶれの中(×0.99〜1.43) | +61 B | 変わらない |
| (E2 の前の版) | 作るときに `c.header()` のヘッダーを全部入れておく | mw | 測る前に外した | +74 B | **変わる**(6.3) |
| (perf-0.3 の 6.7) | Host を信頼する設定を足す | Deno | 測っていない | +20 B ほど | 設定を間違えるとパスのすり替えを許す。勧めない |
| (perf-0.3 の 6.1) | 同期のハンドラーなら Promise にしない | — | VM で差が見えず、外した | -1 B | 型が変わる |

### 6.1 E1: `splitPath` を 1 回の走査にする

- **何をするか:** 今は `pathname.split("/")` で配列を作ってから、セグメントごとに `includes("%")` を見ています。文字を 1 回なめて、区切りと `%` を同時に見つけます。デコードと 400 の規則は同じです
- **根拠:** param で `splitPath` が Bun 8.0%・Deno 16.6%・Node 4.0%(4 章)
- **速さ(手元、21 ラウンド × 300 ms、2 回):**

  | ランタイム | base | E1 | 比 |
  |---|---:|---:|---:|
  | Bun | 2,890 / 2,890 ns | 2,505 / 2,759 ns | ×1.154 / ×1.047 |
  | Deno | 4,736 / 4,677 ns | 4,241 / 3,957 ns | ×1.117 / ×1.182 |
  | Node.js | 20,771 / 19,532 ns | 19,155 / 18,238 ns | ×1.084 / ×1.071 |

  この 2 回は 3 つとも速い向きでしたが、最小〜最大の幅は重なっています。その前の回(7 ラウンド・9 ラウンド・15 ラウンド)では、Bun が ×1.429・×1.060・×0.992 と、まちまちでした。**手元では「小さく速い向き」までしか言えないので、VM で差が見えたら入れます**
- **大きさ:** +61 B(前に測った +64 B とほぼ同じ)
- **壊れる心配:** 小。今の `splitPath` と、でたらめなパス 2 万通り(`a / % 2 e F . b %2F %2e %E3%81%82 %E3` の組み合わせ)と境目の例 21 個(`/`、空、`//a//b/`、`%2F`、`%2e%2e`、不正な `%` など)を比べ、結果(400 も含む)がすべて同じでした。bun test も通ります
- **差分:** [`size-0.4/e1.diff`](size-0.4/e1.diff)

### 6.2 E2: `c.header()` のあとに Response を作り直さない

- **何をするか:** `c.json()` / `c.text()` / `c.html()` で作った Response を `Context` が覚えておき、`finalize` に来たのがそれなら、そのヘッダーに直接足して、そのまま返します。それ以外の Response(`fetch()` の結果、`Response.redirect()`、ミドルウェアが包み直したもの)は、今までどおり写してから作り直します
  - 足し方の規則(`c.header()` の値が勝つ、Content-Type と Location はレスポンスのものが勝つ、Set-Cookie は足す)は、今の `finalize` のコードをそのまま使います。変わるのは「写してから足す」が「直接足す」になるところだけです
  - `new Response(body, { headers: 共有の Headers })` は、渡した Headers を写して持つので、`res.headers` はその Response だけのものです。共有の `TEXT_HEADERS` などは書き換わりません
- **根拠:** mw で `finalize` が Bun total 34.5%(4 章)。perf-0.3 の 6.5 と同じ場所です
- **速さ(手元、mw、21 ラウンド × 300 ms、2 回):**

  | ランタイム | base | E2 | 比 |
  |---|---:|---:|---:|
  | Bun | 12,299 / 12,980 ns | 9,529 / 9,956 ns | ×1.291 / ×1.304 |
  | Deno | 22,615 / 26,641 ns | 11,628 / 13,730 ns | ×1.945 / ×1.940 |
  | Node.js | 36,067 / 33,791 ns | 31,022 / 31,198 ns | ×1.163 / ×1.083 |

  Bun と Deno は、その前の回(9 ラウンド・15 ラウンド)でも Deno ×1.79・×2.29 と同じ向きでした(Bun は ×0.88・×1.25 と 1 回外れ)。text と json は、21 ラウンドで 2 回測って ×0.965〜×1.055 で、変わりません
- **大きさ:** +26 B(perf-0.3 で測った前の作りは +138 B)
- **挙動:** 変わりません。bun test(2,003)と Node のテスト(276)がすべて通ります。Node のテストには、Request を作らない道と `app.fetch` の道で、純正のミドルウェアを全部つけた応答が同じかを比べるものがあり、それも通ります
- **残る違い(見込み):** ブラウザの `Response` のヘッダーは Set-Cookie を受け付けませんが、今の作り方(新しい `Headers` を `Response` に渡す)でも同じく落ちるので、違いは出ない見込みです。確かめてはいません
- **差分:** [`size-0.4/e2.diff`](size-0.4/e2.diff)

### 6.3 E2 の前の版(作るときに入れておく)を外した理由

最初は、perf-0.3 の 6.5 のとおり「`c.json()` などで作るときに、`c.header()` のヘッダーを全部入れておき、`finalize` では何もしない」形で作りました(+74 B)。これは Node のテストが 5 つ落ちました。

- `next()` のあとで Response のヘッダーを書き換えるミドルウェア(`cors()` が `res.headers.set("access-control-allow-origin", ...)` をする)があると、今は `c.header()` の値が最後に勝ちますが、この形ではミドルウェアの値が勝ちます
- `etag()` は `next()` のあとで `res.headers.get("etag")` を見ます。`c.header("etag", ...)` の値が先に見えるようになり、304 になるかどうかが変わりました
- Node の近道(`PlainResponse`)は今の規則のままなので、2 つの道で応答が食い違いました

ヘッダーを先に見せると規則が変わるので、6.2 の「作り直さずに、あとから直接足す」形にしました。

### 6.4 大きさの都合で見送っていたもの

perf-0.3 で、大きさが当時の上限(7 KB)に収まらず見送ったのは、6.5(= E2)と 6.6(= E1)の 2 つでした。

- E2 は作りを変えて +26 B になり、余裕(509 B)にも、削ったあとの余裕にも十分収まります。手元でも効きました
- E1 は +61 B で、大きさの上では入ります。手元の差が小さいので、VM の結果で決めます

---

## 7. 組み合わせの案

どれも、差分を順に当てて `bun run size` で測った値です(今は 7,683 B、上限 8,192 B)。

| 案 | 中身 | 大きさ | 今との差 | 上限までの残り | 速さ(手元) |
|---|---|---:|---:|---:|---|
| 案 1 | X2 + X1 + X5 | 7,444 B | -239 B | 748 B | 変わらない |
| 案 1' | X2 + X1b + X5 | 7,357 B | -326 B | 835 B | 変わらない |
| **案 2** | **X2 + X1 + X5 + E2** | **7,474 B** | **-209 B** | **718 B** | **mw が Bun ×1.3・Deno ×1.9** |
| 案 2' | X2 + X1b + X5 + E2 | 7,388 B | -295 B | 804 B | 同じ |
| 案 3 | X2 + X1 + X5 + E1 + E2 | 7,533 B | -150 B | 659 B | 案 2 に加えて、param が少し(VM で確かめる) |
| 案 3' | X2 + X1b + X5 + E1 + E2 | 7,447 B | -236 B | 745 B | 同じ |
| (参考)E1 + E2 だけ | | 7,769 B | +86 B | 423 B | 案 3 と同じ |

- **勧めるのは案 2 です。** 削って空いた分の一部で E2 を入れても、今より 209 B 小さくなります。E2 は手元で 3 つのランタイムとも mw で速くなり、挙動が変わりません
- **E1 は、VM で param に差が見えたら足して案 3 にします。** 見えなければ入れません(測って差が出ないものは入れない)
- X1 と X1b はどちらでもよく、X1b にするとどの案もさらに 86〜87 B 減ります(5.3)
- 組み合わせのテストは、案 3 と案 2' で回しました。どちらも bun test は案内のテスト 1 つ(X1 で文言が変わる・X1b で案内が消える)だけが落ち、Node のテスト(276)と `bun run build`(型)は通りました

---

## 8. VM で測ってほしいもの

`bash perf-vm.sh compare` は、origin/main と作業中の src を、ランタイムごとに Hono と交互に測ります(static / param / mw)。候補ごとの差分を [`size-0.4/`](size-0.4/) に置いたので、当ててから回してください。

| 順 | 当てる差分 | 見たいところ | 時間の目安 |
|---|---|---|---|
| 1 | `e2.diff` | mw が Bun・Deno・Node で上がるか。static・param が下がらないか | 約 12 分 |
| 2 | `e1.diff` | param が上がるか(これで E1 を入れるかを決めます) | 約 12 分 |
| 3 | `x2.diff` | Node の static・param が下がらないか(近道のコードを動かしたため) | `node` だけで約 4 分 |
| 4 | 案 2 か案 3(`x1.diff x2.diff x5.diff e2.diff [e1.diff]`) | 組み合わせても 1・2 と同じ向きか | 約 12 分 |

手順(リポジトリのルートで。この PR のブランチか、マージしたあとの main で):

```sh
git fetch && git switch docs/size-0.4   # マージしたあとなら main
cd bench && bun install --frozen-lockfile && cd ..

git apply docs/design/size-0.4/e2.diff
(cd bench && bash perf-vm.sh compare)          # 3 つのランタイム。1 つだけなら compare node など
git checkout -- src adapters && git clean -fd src   # 次の候補の前に戻す

git apply docs/design/size-0.4/e1.diff
(cd bench && bash perf-vm.sh compare)
git checkout -- src adapters && git clean -fd src

git apply docs/design/size-0.4/x2.diff
(cd bench && bash perf-vm.sh compare node)
git checkout -- src adapters && git clean -fd src

for p in x1 x2 x5 e2 e1; do git apply docs/design/size-0.4/$p.diff; done   # 案 3。案 2 なら e1 を外す
(cd bench && bash perf-vm.sh compare)
git checkout -- src adapters && git clean -fd src
```

- `compare` は origin/main を基準にするので、PR のブランチのままでも、差は当てた差分の分だけです
- 差分は 0675d2f の src に合わせて作りました。#176 がマージされたあとは、`e2.diff` が当たらないことがあります(9 章)。そのときは `git apply -3` で当てるか、声をかけてください
- 結果は「main ÷ Hono」と「src ÷ Hono」の倍率で比べます。perf-0.3 の 2.1 のとおり、別の回どうしの数字は比べず、同じ回の中で比べます

---

## 9. 進め方と、ほかの作業とぶつかるところ

- もう一つのセッションが、#176(案 D、`c.json()` と `c.text()` の型の重ね書き)を進めています。#176 は src/context.ts の `json()` / `text()` の宣言を増やすだけで、中身は変えていませんが、**E2 は同じメソッドの中身を書き換える**ので、#176 を取り込んでから作ります
- **X2** も src/context.ts(static ブロックと末尾の `LazyContext`)を触ります。#176 の場所とは離れていますが、同じく #176 のあとにします
- E1 と X5 は src/router.ts と src/app.ts、X1 / X1b は src/app.ts だけです。型まわりには触りません
- ドキュメントの型付きクライアントのページには、どの候補も触りません
- 入れるときは、候補ごとに 1 PR にして、`bun run size` の前後と、VM の結果を PR に書きます

---

## 10. 手元での作業について

- 候補の写し、プロファイル、ベンチのスクリプトは、リポジトリの外の一時フォルダーに置きました。src は変えていません(テストを回すときだけ、この PR の worktree の src に写しを入れ、回したらすぐ戻しました)
- PR に入れたのは、このメモと、候補ごとの差分([`size-0.4/`](size-0.4/))だけです。差分はコードとして読まれないファイル(`.diff`)なので、本体にもテストにも入りません
- 手元の bun test で、1 回だけ `client()` の時間を見るテスト(「"/" が長く続いて最後が別の文字のベース URL でも、すぐ終わる」)が落ちました。E2 の写しのときで、同じテストだけを 3 回回し直すと通りました。E2 は client に関係しないので、時間で揺れるテストと見ています
