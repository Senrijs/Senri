# 速度の調査(0.3)

> 状態: 調査だけ(src は変えていません)。直す範囲は、この結果を見て決めます。

Bun・Node.js・Deno のそれぞれで、Senri が 1 リクエストのどこに時間を使っているかを調べました。そのうえで、直す候補を根拠つきで並べます。

前提:

- 目指すのは「汎用的でちょっと速い」です。ベンチの 1 位は狙わず、Hono と同じくらいを目指します
- グローバルの `Request` / `Response` を書き換える方法(Hono の `overrideGlobalObjects` のようなもの)は、候補に入れません
- 大きさの上限は、`bun run size` の最小アプリで gzip 後 7 KB(7,168 B)です。今は 7,112 B で、余裕は 56 B です

---

## 1. 結論

- **今の Hono との差(VM、Hono に対して何倍か)** は次のとおりです(7.1)

  | | static | param | mw |
  |---|---:|---:|---:|
  | Bun | 0.92 | 0.99 | 1.04 |
  | Node.js | 0.86 | 0.87 | 0.87 |
  | Deno | 0.80 | 0.78 | 1.28 |

- **「Bun が 0.2.9 から遅くなった」は再現しませんでした。** VM で 0.2.8・0.2.9・0.2.10・0.3.1・今の src を Hono と交互に測ると、倍率の幅が重なり、0.3.1 と今の src がいちばんよい結果でした(3 章)
- **「いつも Promise を返す」ことが、Bun で 3〜4%、Deno で 6〜9% 効いています。** Hono の `fetch` を async で包んだだけのもの(`hono-async`)が、その分だけ Hono より遅くなりました(7.2)。前に「差が出なかった」とした同期入口の試し(2026-11-06)とは食い違うので、候補に戻します(5.3)
- **Deno の static の約 0.73 倍は、2 つでほぼ説明がつきます。** Promise(-9%)と、Content-Type を付けた Response の作り方(-16%)です。掛けると約 0.77 になります。param の残りの約 1 割は、Host の確かめなどの疑いです(5.1)
- **Bun の static の約 1 割の負けは、主に Promise の分です。** Response の作り方は、Bun ではほとんど効いていません。param では、Senri の作り方のほうが Hono より速いくらいでした(5.2)
- **Node.js は、どのシナリオでも約 13% 負けています。** プロファイルで見つかった `URL.canParse` と、ミドルウェアがあるときに Request を作っていることが、主な候補です(4.2)
- **直す候補は 7 つです**(6 章)。上の 4 つ(同期で返す、Node の 2 つ、Deno の文字列)は、合わせても大きさの上限に収まる見込みです

---

## 2. 測り方

### 2.1 VM(本番の数字)

ベンチ用の VM(ibuki-bench、EPYC 8 vCPU)で、wrk を使って測ります。VM は友人の Proxmox の上にあって、ほかの VM の負荷で数字がぶれるので、絶対値ではなく **Hono に対して何倍か** で比べます。

- 並びは「Hono, A, Hono, B, Hono, A, …」です。A の倍率は「A の req/s ÷(すぐ前の Hono とすぐ後の Hono の平均)」です
- 1 回 6 秒、3〜4 ラウンドで、最初にそれぞれ 3 秒ずつ温めます。サーバーはコア 0〜3、wrk は 4〜7 に固定し、`wrk -t4 -c64` で測ります
- 頭打ちを見分けるため、フレームワークなしの raw(同期で `new Response("ok")` を返すだけ)も同じく毎ラウンド測ります。Hono が raw の中央値の 9 割を超えたら ⚠ を付けます
- 使うもの: [`bench/perf-vm.sh`](../../bench/perf-vm.sh)、[`bench/perf-abab.ts`](../../bench/perf-abab.ts)、[`bench/perf-serve.ts`](../../bench/perf-serve.ts)(使い方は 7 章)
- 同じ日の別の回で、同じ組み合わせの倍率が 7% ほど違ったことがあります(Deno static: main 0.802、causes 0.730)。なので、**別の回どうしの数字は比べず、同じ回の中で比べます**

シナリオは 3 つです([`bench/scenarios.ts`](../../bench/scenarios.ts))。

| シナリオ | 中身 |
|---|---|
| static | `GET /` で文字列 `"hi"` を返す |
| param | `GET /users/:id` で `{ id }` の JSON を返す |
| mw | param に、requestId + cors + 小さな自前ミドルウェア(`c.header()` で 1 つ足す)をつける。requestId がない 0.2.12 より前の版では、同じことをする自前のものを使う |

### 2.2 手元(割合と、版や案どうしの差だけ)

手元は Windows 11(Bun 1.4.3・Node.js 24.11.0・Deno 2.9.8)で、wrk がありません。なので手元の数字は、**プロファイルの割合と、版や案どうしの差を見るためだけ**に使います。

- **プロセスの中で `app.fetch` を呼ぶ**([`bench/versions.ts`](../../bench/versions.ts)): 同じ Request を使い回して呼び、本文も読みます。7 ラウンドを交互に測った中央値と、最小〜最大を出します
- **CPU プロファイル**([`bench/perf-profile.ts`](../../bench/perf-profile.ts)、[`bench/perf-profile-http.ts`](../../bench/perf-profile-http.ts)、[`bench/perf-profile-summary.ts`](../../bench/perf-profile-summary.ts)):
  - Node.js と Deno は、サーバーを立てて要求を送り続け、そのあいだのサーバーを取りました(HTTP 経由)。Node は `--cpu-prof`、Deno は `--cpu-prof` がないので `node:inspector` で取ります。送る側は Bun の `fetch` を 32 本並べただけのもので、req/s の数字は使いません
  - Bun は、プロセスの中で `app.fetch` を回して `--cpu-prof` で取りました。HTTP 経由で取ると、待っている時間まで最後に動いていた JS の関数に付いてしまい(`pathnameOf` が 55% など)、使えませんでした
  - サンプリングは 1 ms おきです。Windows で 100 µs にすると、サーバーが数十分の 1 しか答えなくなったためです
  - それぞれ 1 回(8 秒)ずつ取りました。割合は数 % ぶれると考えてください

---

## 3. Bun が 0.2.9 から遅くなった件: 再現せず

VM で、npm に出ている版を Hono と交互に測りました(npm にない 0.2.16・0.2.18・0.2.22〜0.3.0 は飛ばしました)。

Bun 1.4.4 / EPYC 8 vCPU / `wrk -t4 -c64 -d6s` / 3 ラウンド

| シナリオ | 版 | Hono に対して(中央値) | 最小〜最大 | req/s |
|---|---|---:|---:|---:|
| static | 0.2.8 | 0.863 | 0.859–0.885 | 45,342 |
| static | 0.2.9 | 0.847 | 0.824–0.869 | 44,438 |
| static | 0.2.10 | 0.896 | 0.896–0.902 | 47,665 |
| static | 0.3.1 | 0.911 | 0.900–0.912 | 47,666 |
| static | 今の src | 0.900 | 0.883–0.909 | 47,325 |
| param | 0.2.8 | 0.922 | 0.883–0.924 | 40,102 |
| param | 0.2.9 | 0.908 | 0.881–0.932 | 39,564 |
| param | 0.2.10 | 0.929 | 0.882–0.949 | 38,741 |
| param | 0.3.1 | 1.008 | 0.976–1.021 | 43,380 |
| param | 今の src | 0.983 | 0.970–1.012 | 42,850 |

- 0.2.9 で下がった様子はありません。どの版も幅が重なっていて、0.3.1 と今の src がいちばんよい結果です
- 0.2.8 → 0.2.9 の変更は、ワイルドカードのルート(#41)と開発モードの警告(#43)だけで、本番の道はほとんど変わっていません
- 手元でプロセスの中で比べても(Bun 1.4.3、2 ラウンド)、0.3.1 は 0.2.9 より遅くありませんでした(static 2.8 → 1.6 µs、param 7.1 → 3.7 µs)
- **この件は「再現せず」として閉じます。** ただし static の約 1 割の負けは、どの版でも一貫しているので、本物の差として 5.2 で扱います
- この回の raw は、古い測り方(1 回だけ、パスを見て答える)だったので、⚠ の判定は使えません。今の測り方には直してあります

---

## 4. ランタイムごとの内訳

### 4.1 Bun(プロセスの中で `app.fetch` を回したもの)

分類ごとの割合:

| シナリオ | Senri | ランタイム(Response など) | そのほか |
|---|---:|---:|---:|
| static | 48.3% | 49.8% | 1.9% |
| param | 59.1% | 38.2% | 2.7% |
| mw | 48.7% | 50.5% | 0.8% |

時間を使っている関数の上位(self は関数そのもの、total は呼んだ先も含む):

| シナリオ | 関数 | self | total | 読み方 |
|---|---|---:|---:|---|
| static | `Response`(ランタイム) | 43.8% | 43.8% | Response を作るところ。Hono の static も 38.0% |
| static | `Context` のコンストラクター | 12.5% | 14.0% | フィールドの用意。減らす実験(E3)では差が出なかった |
| static | `resolve`(app.ts) | 11.0% | 16.6% | 静的なルートの表(Map)を引く |
| static | `pathnameOf`(router.ts) | 4.0% | 4.0% | URL を丸ごと解析はしていない(文字列を 1 回なめるだけ) |
| param | `Response`(ランタイム) | 26.0% | 26.0% | |
| param | `splitPath`(router.ts) | 17.1% | 17.1% | `split("/")` で配列を作ってから、セグメントごとに `includes("%")` を見ている |
| param | `JSON.stringify` | 6.9% | 6.9% | |
| param | `seek`(matcher.ts) | 6.3% | 6.3% | ルーター探索。重くはない |
| param | `get path`(context.ts) | 4.3% | 10.3% | |
| mw | `finalize`(context.ts) | 8.9% | **34.6%** | `c.header()` を使うと、最後に Headers をコピーして Response を作り直す。`forEach` 10.1%・`Headers` 4.2%・`set` 5.0% もここから |
| mw | `compose` の `dispatch` / `step` | 7.4% | 41.6% | async 関数の入れ子。Hono も同じ形 |

- 見るように言われた 4 つのうち、パスの切り出し(`pathnameOf`)は URL を丸ごと解析していません。`splitPath` は param で目立ちます
- `Context` を作るときに使わないものまで作っている、というほどではありません。フィールドを減らす実験(E3)をしても差が出ませんでした
- ルーター探索(`seek` 6.3%、`staticLeaf`)は重くありません
- Response の余計なコピーは、`c.header()` を使ったとき(mw)にだけ起きていて、これがいちばん大きいです
- プロセスの中のプロファイルには、`Bun.serve` が Promise を待つ手間は出てきません。VM で見えた Promise の分(5.3)は、ここでは見えていません

### 4.2 Node.js(`@senrijs/senri/node` で立てたサーバーを HTTP 経由で)

VM では、static 0.86・param 0.87・mw 0.87 倍で、どのシナリオでも約 13% 負けています(7.1)。

| シナリオ | Senri | ランタイム | `(program)` と GC |
|---|---:|---:|---:|
| static | 12.5% | 76.4% | 11.1% |
| param | 11.1% | 79.3% | 9.6% |
| mw | 13.3% | 81.7% | 4.9% |

- static と param は、Request も Response も作らない近道(#46・#47)を通っています。時間の大半はソケットへの書き込み(`writev` 20〜40%)で、Senri のコードは 1 割ほどです
- **`URL.canParse` が 4〜5% あります**(static 5.0%、param 4.3%)。アダプターが、Request を作らない道でも不正な URL を 400 にするために、毎回呼んでいます
- **mw では近道を外れます。** 自前のミドルウェアには `markPlainSafe` の印がないので、本物の Response を作ります。それとは別に、**Request まで作っています**(`create` が total 9.9%、undici の `_Request` が 8.2%)。`respond()` が HEAD かどうかを `c.req.method` で確かめるためで、メソッドはアダプターがもう持っています
- Hono(`@hono/node-server`)も、param で Hono 自身は 11.2% と同じくらいでした
- Node.js は causes(差の切り分け)の対象にしていません。Senri のコードが 1 割ほどしかないのに 13% 負けているので、上の 2 つで全部は埋まらない見込みです。残りは、アダプターの書き出し方(`writev` の使い方など)の違いを疑っていますが、今回は調べていません

### 4.3 Deno(`Deno.serve` で立てたサーバーを HTTP 経由で)

| シナリオ | Senri | ランタイム | `(program)` と GC |
|---|---:|---:|---:|
| static | 24.5% | 62.0% | 13.1% |
| param | 41.0% | 48.0% | 9.9% |
| mw | 29.8% | 62.8% | 6.7% |

| シナリオ | 関数 | self | total | 読み方 |
|---|---|---:|---:|---|
| static | `requestPathname`(router.ts) | 3.7% | **16.8%** | Host の確かめ。`req.headers.get("host")` で、ヘッダーを全部 JS に作り直す(`get headerList` 10.2%、`op_http_get_request_header` 5.6%) |
| static | `text` → Response を作る | — | 18.1% | Content-Type を渡すので、ヘッダーの表を作る(`initializeAResponse` 11.9%、`fillHeaderList` 7.9%) |
| static | `capRequest`(app.ts) | — | 6.1% | GET なのでメソッドを読むだけ。Deno ではメソッドを読むのも op |
| param | `splitPath`(router.ts) | 8.9% | 8.9% | Bun と同じ |
| mw | `finalize`(context.ts) | 2.0% | **39.5%** | Bun と同じく、Response の作り直し。Headers を回す `createDefaultIterator` 7.2% もここから |

- mw では、VM で Senri が Hono の 1.28 倍でした。Hono の requestId と cors のほうが重いためで、ここは直す必要がありません

---

## 5. Hono との差の理由

VM の causes(7.2)では、Hono を 2 通りに変えて、差を切り分けました。

- `hono-async`: Hono の `fetch` を `async (req) => fetch(req)` で包み、いつも Promise を返すもの(Promise の分)
- `hono-init`: ハンドラーが Senri と同じ `new Response(body, { status: 200, headers: <共有の Headers> })` を返すもの(Response の作り方の分)

どちらも、Hono より遅くなった分が、その違いの重さです。

| | static | param |
|---|---:|---:|
| **Bun** Senri | 0.937 | 0.949 |
| Bun hono-async | 0.961(-4%) | 0.966(-3%) |
| Bun hono-init | 0.986(-1%) | 1.067(+7%) |
| **Deno** Senri | 0.730 | 0.764 |
| Deno hono-async | 0.906(-9%) | 0.943(-6%) |
| Deno hono-init | 0.844(-16%) | 0.915(-9%) |

### 5.1 Deno(約 0.75 倍)

- **static は 2 つでほぼ説明がつきます。** Promise(0.906)と Response の作り方(0.844)を掛けると 0.765 で、Senri の 0.730 との差は約 5% です
- **param は約 1 割残ります。** 掛けると 0.863 で、Senri の 0.764 との差は約 11% です。残りは、Host の確かめ(プロファイルで total 16.8%)と `splitPath`(8.9%)を疑っています

同じ条件で Hono のプロファイルと並べると、違いは次のとおりです。

| | Senri | Hono |
|---|---|---|
| 戻り値 | いつも Promise | 同期のハンドラーなら Response をそのまま返す |
| Host ヘッダー | 読む(パスのすり替えを防ぐため)。ヘッダーを全部作り直すので重い | 読まない |
| static の Response | `new Response(body, { status, headers: <Content-Type の Headers> })`。Deno は `op_http_set_response_body_static_with_content_type` を使い、その前にヘッダーの表を作る | `new Response(text)`(init なし)。Deno は `op_http_set_response_body_static_with_default_header` の近道を使う(Hono の static で 16.6%) |
| `Deno.serve` の使い方 | `Deno.serve(fetch)`。同じ | 同じ |

- **Host の確かめは外せません。** Deno 2.9.8 で、生のソケットから不正な Host を送って確かめました。`Host: x/admin#` で `GET /public` を送ると、`req.url` は `http://x/admin#/public` になります(Deno は Host をそのまま URL につなぐ)。確かめないと、パスが `/admin` にすり替わります
  - wrk は Host しか送らないので、ヘッダーを作り直す手間は、手元(Bun の `fetch` はヘッダーを 5 つほど送る)より VM のほうが小さいはずです
- **Response の作り方の差は、プロセスの中でも測れました。** Deno で、Response を作るだけを 30 万回(5 ラウンドの中央値):

  | 作り方 | Bun | Deno |
  |---|---:|---:|
  | `new Response(s)`(Hono の static) | 1.7 µs | 0.6 µs |
  | `{ status, headers: 共有の Headers }`(Senri) | 2.4 µs | 2.2 µs |
  | `{ status, headers: { ... } }`(素のオブジェクト) | 3.1 µs | 3.6 µs |
  | `{ status }` だけ | 2.4 µs | 0.6 µs |

  Deno では status は効かず、ヘッダーを渡すだけで約 1.6 µs 増えます。Senri の今の形(共有の Headers)は、ヘッダーを渡す形の中ではいちばん速いです
- param(JSON)は Content-Type が `application/json` でなければならないので、init なしにはできません。なので 6.4 の候補は static(文字列)にしか効きません

### 5.2 Bun(static 約 0.92 倍、param 約 0.95〜0.99 倍)

- プロセスの中では、Senri と Hono はほぼ同じです(手元、2 ラウンド: Senri 2.2 µs、Hono 2.8 µs。ばらつきが大きい)。差は `Bun.serve` を通したときに出ています(HTTP 側)
- **static の差は、主に Promise の分です。** `hono-async` が -4%、`hono-init` が -1% で、掛けると 0.948 です。Senri の 0.937 とほぼ合います
- **Response の作り方は、Bun ではほとんど効いていません。** static の `hono-init` は 0.986(0.978–1.026)で、ぶれの中です。param では 1.067 で、Senri の形(共有の Headers を渡す)のほうが、Hono の `c.json()` より速いくらいでした。なので、前に疑っていた「Bun でも init なしの Response にする」は候補から外します(6.8)
- param は、掛けると 1.031 なのに Senri は 0.949 で、約 8% が Senri の中に残ります。プロセスの中のプロファイルで目立つ `splitPath`(17.1%)を疑っています
- Bun の static は、Hono が raw の 0.90〜0.94 で、⚠(頭打ちの近く)が付いています。差が縮んで見えている可能性があるので、Bun の static の倍率は控えめに読んでください

### 5.3 「いつも Promise を返す」の重さ

- `hono-async` は、Hono の Response をそのまま `async` で包んだだけなので、違いは Promise だけです。それで Bun は 3〜4%、Deno は 6〜9% 遅くなりました
  - Deno は static で 0.895–0.909 と、幅が 1 から十分離れています。Bun は幅の上が 1.014・1.003 で 1 にかかるので、Bun の数字は自信が中くらいです
- 2026-11-06 に `serve()` の同期入口を試したとき(Bun 49,926 → 49,821、Deno 47,679 → 47,813 req/s)は差が出ず、今回と食い違います。理由として、次の 2 つを考えています(当時の測り方の記録が残っていないので、確かめられません)
  - あのときは前後を 1 回ずつ測っただけで、Hono と交互に測っていません。この VM では、別の回で同じ組み合わせが 7% ほどずれることがあるので(2.1)、数 % の差は埋もれます
  - ベンチのサーバーは `Bun.serve({ fetch: app.fetch })` / `Deno.serve(app.fetch)` で立てていて、`serve()` を通りません。同期入口が `serve()` の中だけだったなら、測った道を通っていません
- 今回は ABAB で、同じ回の中で 3 ラウンドとも同じ向きに出ているので、こちらを信じます。なので「同期で返す」を候補に戻します(6.1)

---

## 6. 直す候補の一覧

効果が大きく、手間とリスクが小さい順に並べます。上がる幅は、VM の causes(7.2)、プロファイル、プロセスの中の差から見積もりました。VM で直したものを測ったわけではありません。

| # | 何をするか | 効きそうなランタイム | 上がりそうな幅 | 大きさ | 壊れる心配 | 手間 |
|---|---|---|---|---:|---|---|
| 1 | ミドルウェアがなく同期のハンドラーなら、`app.fetch` が Response をそのまま返す(Promise にしない) | Deno・Bun(ミドルウェアなし) | Deno +6〜9%、Bun +3〜4% | -1 B | 中(型が変わる) | 小 |
| 2 | Node のアダプターで、`URL.canParse` を毎回呼ばない | Node(static・param) | +3〜5% | 0 B | 中 | 小 |
| 3 | `respond()` の HEAD の確かめを `methodOf(c)` にして、Node で Request を作らない | Node(利用者のミドルウェアがあるとき) | +5〜10%(自信なし) | +18 B | 小 | 小 |
| 4 | Deno では、ヘッダーがなく 200 の文字列を `new Response(text)` で作る | Deno(static) | +10〜15% | +35 B | 中 | 小 |
| 5 | `c.header()` のあとの `c.json()` / `c.text()` / `c.html()` は、最初から全部のヘッダーを入れて作り、`finalize` で作り直さない | 全部(`c.header()` を使うミドルウェアがあるとき) | +10〜20%(自信なし) | +138 B | 中 | 中 |
| 6 | `splitPath` を、`split` を使わない 1 回の走査にする | 全部(パラメーターのあるルート) | +2〜4%(自信なし) | +64 B | 小 | 小 |
| 7 | Host を信頼する設定(`createApp({ trustHost: true })` など)を足し、Deno で Host を読まずに済むようにする | Deno | +5〜10%(自信なし) | +20 B ほど | 大 | 小 |

1〜4 は、合わせて +52 B ほどで、余裕の 56 B に収まる見込みです(6.9)。

### 6.1 同期で返せるときは、`app.fetch` が Response をそのまま返す

- **何をするか:** `app.fetch` の近道(ミドルウェアがないとき)の `return Promise.resolve(end(res))` を `return end(res)` にします。戻り値の型は `Promise<Response>` から `Response | Promise<Response>` になります(Hono の `fetch` と同じ型です)。`Bun.serve` も `Deno.serve` も、どちらの形でも受け取れます
- **根拠:** causes の `hono-async` が、Bun で -4% / -3%、Deno で -9% / -6% でした(5.3)
- **大きさ:** -1 B(今の src の 1 行を書き換えて、`bun run size` と同じ形で測りました。7,112 → 7,111 B)
- **壊れる心配:** 中。公開している型が変わります。`app.fetch(req).then(...)` と書いている利用者のコードは、型の上でも動きの上でも壊れます(リポジトリの中には、そう書いているところはありませんでした)。テストで `await app.fetch(req)` と書いているところは、そのまま動きます。型を変えたくないときは、`serve()` だけが使う同期の入口を別に足す形もありますが、ベンチのように `Bun.serve({ fetch: app.fetch })` と書く人には効かず、大きさも増えます
- ミドルウェアがあるときは `compose` が Promise なので、変わりません
- 0.3 の破壊的な変更として入れるかどうかを、決めてください

### 6.2 Node で `URL.canParse` を毎回呼ばない

- **何をするか:** `serveLazily` は、Request を作らない道でも、Request にしたら投げる URL を 400 にするため、毎回 `URL.canParse(url)` を呼んでいます。アダプターは Host とリクエストの対象をすでに自分で確かめているので、`URL.canParse` が落とすものだけを安く見分ける形にします
- **根拠:** Node の HTTP 経由のプロファイルで、`canParse` の self が static 5.0%、param 4.3% です。VM では Node はどのシナリオでも約 13% 負けています
- **大きさ:** アダプター(`@senrijs/senri/node`)は本体の最小アプリに入らないので、0 B です
- **壊れる心配:** 中。`URL.canParse` が落とすもの(不正な Host の残り、ポートの範囲など)を取りこぼすと、Request を作ったときに初めて投げるようになります。今の 400 のテストを、Request を作らない道でも全部通す必要があります

### 6.3 Node で、HEAD の確かめのために Request を作らない

- **何をするか:** `app.ts` の `respond()` の `c.req.method !== "HEAD"` を `methodOf(c) !== "HEAD"`(`src/plain.ts`)にします。Node のアダプターから来たときは、Request を作らずにメソッドを読みます
- **根拠:** mw の Node のプロファイルで、`create`(Request を作る)が total 9.9%、undici の `_Request` が 8.2% です。このシナリオのハンドラーもミドルウェアも、`c.req` を読んでいません。VM の mw は 0.87 倍です
- **大きさ:** +18 B(実験 N1)
- **壊れる心配:** 小。`methodOf` はメソッドを読むだけで、純正のミドルウェアがもう使っています
- 純正でないミドルウェアがあると Response を作る点は変わりません(これは #47 で決めたことです)

### 6.4 Deno で、ヘッダーのない文字列を `new Response(text)` で作る

- **何をするか:** Deno で動いていて、`c.header()` がなく、status が 200 のとき、`c.text()` は init なしの `new Response(text)` にします。Deno だけに当てます(Bun では効かないため。5.2)
- **根拠:** causes の `hono-init` が Deno の static で -16% でした。Response を作るだけなら 2.2 → 0.6 µs で(5.1)、プロセスの中の static は 1,704 → 965 ns(Deno、7 ラウンド)でした。HTTP では Deno の近道の op(`..._with_default_header`)も使えるようになります
- **大きさ:** +35 B(実験 E4)
- **壊れる心配:** 中。Deno での Content-Type が `text/plain; charset=utf-8` から `text/plain;charset=UTF-8` になります(意味は同じ)。「どのランタイムでも同じ値を付ける」という今の決めごとから外れます。値をそのまま比べているテストや利用者のコードがあると変わります
- param(JSON)には効きません(5.1)。`{ status }` だけなら Deno では速いので、200 以外の文字列にも広げられます

### 6.5 `c.header()` のあとに Response を作り直さない

- **何をするか:** `c.header()` で設定したヘッダーがあるとき、`c.json()` などで Response を作る時点で全部のヘッダーを入れます。その Response のあとに `c.header()` が呼ばれていなければ、`finalize` は何もしません。呼ばれていれば、増えた分だけをその Response に書き足します(Set-Cookie は増えた数だけ)
- **根拠:** プロセスの中で 1 回あたりの時間(ns):

  | | Bun mw | Deno mw |
  |---|---:|---:|
  | 今 | 14,948(11,478–20,752) | 27,414(21,911–38,263) |
  | 実験 E2 | 8,924(7,310–14,619) | 20,460(19,121–38,697) |

  プロファイルでも、`finalize` が total で Bun 34.6%、Deno 39.5% です。ただし VM の mw では、すでに Bun 1.04・Deno 1.28 倍で Hono に勝っています
- **大きさ:** +138 B。**このままでは上限を 82 B 超えます。** 入れるなら、ほかを削るか、作り方を小さくする工夫が要ります
- **壊れる心配:** 中。ヘッダーを重ねる規則(Content-Type と Location はレスポンスのものが勝つ、Set-Cookie は足す)を、作り直しのときと同じに保つ必要があります。実験では、`c.header()` で Content-Type や Set-Cookie を決めた場合、`next()` のあとに足した場合、Response を直接返した場合、エラーの場合、404 の場合で、今と同じヘッダーになることを確かめました(最初の版は、あとから足すと Set-Cookie が 2 回付く誤りがあり、直しました)
- **手間:** 中。上の規則のテストを足す必要があります

### 6.6 `splitPath` を 1 回の走査にする

- **何をするか:** `pathname.split("/")` で配列を作ってから各セグメントで `includes("%")` を見る代わりに、文字を 1 回なめて、区切りと `%` を同時に見つけます
- **根拠:** プロセスの中で 1 回あたりの時間(ns):

  | | Bun param | Deno param |
  |---|---:|---:|
  | 今 | 3,000(2,330–13,270) | 5,102(3,956–9,201) |
  | 実験 E1 | 2,570(2,124–5,063) | 4,178(3,344–6,089) |

  プロファイルでは、`splitPath` が Bun の param で 17.1%、Deno の param で 8.9% です。VM の param で、Promise と Response の作り方で説明できない分が、Bun で約 8%、Deno で約 11% 残っています(5.1・5.2)。HTTP では 1 リクエストのうち Senri の割合が小さいので、上がる幅は小さめに見ています
- **大きさ:** +64 B。**これ 1 つで上限を 8 B 超えます**
- **壊れる心配:** 小。でたらめなパス 2 万通り(`a / % 2 e F . b` の組み合わせ)と、境目の例(`/`、空、`//a//b/`、`%2F`、`%2e%2e`、不正な `%`)で、今と同じ結果(400 も含む)になることを確かめました

### 6.7 Host を信頼する設定(候補には入れますが、勧めません)

- **何をするか:** Host を確かめるプロキシの後ろで動かすときに、Deno での Host の確かめを外せる設定を足します
- **根拠:** Deno の static で、Host の確かめが total 16.8% です。VM の Deno の param で、説明できない分が約 11% 残っています
- **壊れる心配:** 大。設定を間違えると、パスのすり替え(5.1)を許します。「汎用的」という目標にも合わないので、勧めません

### 6.8 候補に入れなかったもの

- **Bun でも、文字列を init なしの `new Response(text)` で作る:** causes の `hono-init` が、Bun の static で 0.986(ぶれの中)、param で 1.067(Senri の形のほうが速い)でした。効かないので外します
- **`Context` を軽くする(実験 E3):** `error` と `route` の初期値をやめ、`params` の既定を共有の凍結したオブジェクトにしました。どのランタイムでも、ばらつきの中に収まって差が出ませんでした(Bun static 1,140 → 1,219 ns、Deno static 1,704 → 1,531 ns、幅が重なっている)
- **グローバルの `Request` / `Response` を書き換える:** 前提のとおり入れません

### 6.9 大きさについて

実験ごとの大きさ(`bun run size` の「bun build・minify あり」と同じ形。今は 7,112 B):

| 実験 | gzip 後 | 差 |
|---|---:|---:|
| 6.1(同期で返す) | 7,111 B | -1 B |
| E1(`splitPath`、6.6) | 7,176 B | +64 B |
| E2(作り直しをしない、6.5) | 7,250 B | +138 B |
| E3(`Context`) | 7,115 B | +3 B |
| E4(Deno の text、6.4) | 7,147 B | +35 B |
| N1(`methodOf`、6.3) | 7,130 B | +18 B |

余裕は 56 B です。1〜4(-1 + 0 + 18 + 35 = +52 B)は、合わせても収まる見込みです(残り 4 B ほど)。5 と 6 は、どこかを削らないと入りません。差は 1 つずつ足したときのもので、組み合わせると gzip の都合で少し変わります。

---

## 7. VM で測るコマンド

```sh
cd Senri && git fetch && git checkout chore/perf-investigation && cd bench
bun install --frozen-lockfile

bash perf-vm.sh main       # Bun / Node.js / Deno × static / param / mw。今の src と raw を Hono と比べる(約 14 分)
bash perf-vm.sh main deno  # 1 つのランタイムだけ(約 5 分)
bash perf-vm.sh causes     # Bun と Deno で、hono-async / hono-init / 今の src を Hono と比べる(約 11 分)
bash perf-vm.sh versions   # Bun で 0.2.8 / 0.2.9 / 0.2.10 / 0.3.1 / 今の src を Hono と比べる(約 9 分)
```

- 1 コアあたり約 60k rps が上限なので、raw も毎ラウンド測り、Hono が raw の 9 割を超えたら ⚠ を付けます。⚠ が出たら、`SERVER_CPUS=0-1` や `CONNECTIONS=32` で測り直すかを決めます
- 古い版は、`mktemp` で作った一時フォルダーに入れて、終わったら消します
- ログは `perf-<日時>.txt`、生の値は `results/perf-*.json` に残ります(どちらも Git に入れません)

### 7.1 ① main の結果

2026-11-13、4 ラウンド。raw の測り方を直す前のスクリプトで測ったので、raw は使えません(⚠ と「Hono ÷ raw」は載せません)。Senri と Hono の倍率は、交互に測っているので使えます。

Bun 1.4.4 / Node.js v24.22.2 / Deno 2.9.8 / AMD EPYC Processor × 8 / `wrk -t4 -c64 -d6s` / サーバーはコア 0〜3、wrk は 4〜7

| ランタイム | シナリオ | Hono に対して(中央値) | 最小〜最大 | Senri req/s | Hono req/s |
|---|---|---:|---:|---:|---:|
| Bun | static | 0.924 | 0.899–0.963 | 50,659 | 54,262 |
| Bun | param | 0.991 | 0.936–1.018 | 41,573 | 42,081 |
| Bun | mw | 1.036 | 0.994–1.070 | 23,806 | 22,976 |
| Node.js | static | 0.856 | 0.838–0.909 | 18,804 | 21,827 |
| Node.js | param | 0.873 | 0.851–0.932 | 16,466 | 18,806 |
| Node.js | mw | 0.869 | 0.775–0.936 | 6,238 | 7,231 |
| Deno | static | 0.802 | 0.786–0.819 | 40,098 | 50,009 |
| Deno | param | 0.775 | 0.712–0.806 | 33,381 | 43,270 |
| Deno | mw | 1.284 | 1.248–1.357 | 15,234 | 11,737 |

- Node.js はどのシナリオでも約 13% 負けています(4.2、6.2・6.3)
- mw は、Bun と Deno では Senri のほうが速いです
- Bun の static は、causes の回で Hono が raw の 0.90〜0.94 だったので、この回も頭打ちの近くだった可能性があります

### 7.2 causes の結果

2026-11-13、d6050a5、3 ラウンド。raw は直した測り方(毎ラウンド、同期の最小のハンドラー)です。

Bun 1.4.4 / Deno 2.9.8 / AMD EPYC Processor × 8 / `wrk -t4 -c64 -d6s` / サーバーはコア 0〜3、wrk は 4〜7

| ランタイム | シナリオ | 相手 | Hono に対して(中央値) | 最小〜最大 | req/s | Hono req/s | Hono ÷ raw |
|---|---|---|---:|---:|---:|---:|---:|
| Bun | static | senri | 0.937 | 0.931–0.962 | 49,857 | 51,807 | 0.92 ⚠ |
| Bun | static | hono-async | 0.961 | 0.948–1.014 | 50,836 | 52,562 | 0.94 ⚠ |
| Bun | static | hono-init | 0.986 | 0.978–1.026 | 50,821 | 50,578 | 0.90 ⚠ |
| Bun | static | raw | 1.099 | 1.076–1.152 | 56,108 | 51,061 | 0.91 ⚠ |
| Bun | param | senri | 0.949 | 0.919–0.996 | 41,237 | 42,599 | 0.77 |
| Bun | param | hono-async | 0.966 | 0.940–1.003 | 41,469 | 42,947 | 0.77 |
| Bun | param | hono-init | 1.067 | 1.062–1.081 | 45,822 | 42,939 | 0.77 |
| Bun | param | raw | 1.294 | 1.236–1.362 | 55,498 | 42,624 | 0.77 |
| Deno | static | senri | 0.730 | 0.727–0.740 | 38,010 | 52,279 | 0.87 |
| Deno | static | hono-async | 0.906 | 0.895–0.909 | 47,165 | 52,339 | 0.87 |
| Deno | static | hono-init | 0.844 | 0.820–0.870 | 44,849 | 53,000 | 0.88 |
| Deno | static | raw | 1.115 | 1.102–1.180 | 59,888 | 53,129 | 0.89 |
| Deno | param | senri | 0.764 | 0.701–0.799 | 33,592 | 42,393 | 0.73 |
| Deno | param | hono-async | 0.943 | 0.839–0.955 | 40,184 | 43,560 | 0.75 |
| Deno | param | hono-init | 0.915 | 0.881–0.943 | 39,853 | 43,568 | 0.75 |
| Deno | param | raw | 1.356 | 1.297–1.367 | 58,023 | 43,667 | 0.75 |

- 読み方は 5 章にまとめました
- Bun の static だけ ⚠ が付いています(Hono が raw の 9 割を超えた)。Bun の static の倍率は、差が縮んで見えている可能性があります。Deno の static も 0.87〜0.89 で、上限に近いです
- 生のログは VM の `~/Senri/bench/perf-20261113-120240.txt`(main)と `perf-20261113-121925.txt`(causes)です

---

## 8. 手元での作業について

- 古い版を入れた場所と、実験のコピー(E1〜E4、N1)は、リポジトリの外の一時フォルダーに置き、終わったら消しました。src は変えていません(6.1 の大きさは、src の 1 行をその場で書き換えて測り、すぐ戻しました)
- プロファイル用のコードは bench の中だけにあります([`bench/perf-profile.ts`](../../bench/perf-profile.ts) など)。サーバーの `PROFILE_MS` は、指定したときだけ動きます
