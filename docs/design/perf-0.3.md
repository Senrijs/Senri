# 速度の調査(0.3)

> 状態: 調査だけ(src は変えていません)。直す範囲は、この結果を見て決めます。
> VM の結果のうち、① main(今の src と Hono)と causes(差の切り分け)はまだ入っていません。「VM の結果待ち」と書いたところに入ります。

Bun・Node.js・Deno のそれぞれで、Senri が 1 リクエストのどこに時間を使っているかを調べました。そのうえで、直す候補を根拠つきで並べます。

前提:

- 目指すのは「汎用的でちょっと速い」です。ベンチの 1 位は狙わず、Hono と同じくらいを目指します
- グローバルの `Request` / `Response` を書き換える方法(Hono の `overrideGlobalObjects` のようなもの)は、候補に入れません
- 大きさの上限は、`bun run size` の最小アプリで gzip 後 7 KB(7,168 B)です。今は 7,112 B で、余裕は 56 B です

---

## 1. 結論

- **「Bun が 0.2.9 から遅くなった」は再現しませんでした。** VM で 0.2.8・0.2.9・0.2.10・0.3.1・今の src を Hono と交互に測ると、倍率の幅が重なり、0.3.1 と今の src がいちばんよい結果でした(3 章)
- **Bun の static で Hono に約 1 割負けているのは、本物の差です**(ラウンドをまたいで一貫しています)。プロセスの中で `app.fetch` を呼ぶと Hono と同じくらいなので、差は `Bun.serve` を通したとき(HTTP 側)に出ています。いちばん疑わしいのは Response の作り方です(5 章)
- **Deno で Hono の約 0.75 倍しか出ない理由は、主に 2 つです。** Host ヘッダーの確かめ(ヘッダーを全部 JS に作り直す)と、Content-Type を付けた Response の作り方です(4 章)
- **直す候補は 7 つです**(6 章)。効果が大きいのは、`c.header()` を使ったときに Response を作り直さないこと(ミドルウェアつきで、プロセスの中では Bun で 40%、Deno で 25% 速い)ですが、大きさが 138 B 増えるので、そのままでは上限を超えます

---

## 2. 測り方

### 2.1 VM(本番の数字)

ベンチ用の VM(ibuki-bench、EPYC 8 vCPU)で、wrk を使って測ります。VM は友人の Proxmox の上にあって、ほかの VM の負荷で数字がぶれるので、絶対値ではなく **Hono に対して何倍か** で比べます。

- 並びは「Hono, A, Hono, B, Hono, A, …」です。A の倍率は「A の req/s ÷(すぐ前の Hono とすぐ後の Hono の平均)」です
- 1 回 6 秒、3 ラウンドで、最初にそれぞれ 3 秒ずつ温めます。サーバーはコア 0〜3、wrk は 4〜7 に固定し、`wrk -t4 -c64` で測ります
- 頭打ちを見分けるため、フレームワークなしの raw(同期で `new Response("ok")` を返すだけ)も同じく毎ラウンド測ります。Hono が raw の中央値の 9 割を超えたら ⚠ を付けます
- 使うもの: [`bench/perf-vm.sh`](../../bench/perf-vm.sh)、[`bench/perf-abab.ts`](../../bench/perf-abab.ts)、[`bench/perf-serve.ts`](../../bench/perf-serve.ts)(使い方は 7 章)

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
- **この件は「再現せず」として閉じます。** ただし static の約 1 割の負けは、どの版でも一貫しているので、本物の差として 5 章で扱います
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

### 4.2 Node.js(`@senrijs/senri/node` で立てたサーバーを HTTP 経由で)

| シナリオ | Senri | ランタイム | `(program)` と GC |
|---|---:|---:|---:|
| static | 12.5% | 76.4% | 11.1% |
| param | 11.1% | 79.3% | 9.6% |
| mw | 13.3% | 81.7% | 4.9% |

- static と param は、Request も Response も作らない近道(#46・#47)を通っています。時間の大半はソケットへの書き込み(`writev` 20〜40%)で、Senri のコードは 1 割ほどです
- **`URL.canParse` が 4〜5% あります**(static 5.0%、param 4.3%)。アダプターが、Request を作らない道でも不正な URL を 400 にするために、毎回呼んでいます
- **mw では近道を外れます。** 自前のミドルウェアには `markPlainSafe` の印がないので、本物の Response を作ります。それとは別に、**Request まで作っています**(`create` が total 9.9%、undici の `_Request` が 8.2%)。`respond()` が HEAD かどうかを `c.req.method` で確かめるためで、メソッドはアダプターがもう持っています
- Hono(`@hono/node-server`)も、param で Hono 自身は 11.2% と同じくらいでした

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

---

## 5. Hono との差の理由

### 5.1 Deno(約 0.75 倍)

同じ条件で Hono のプロファイルと並べると、違いは 2 つです。

| | Senri | Hono |
|---|---|---|
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
- Promise を返すこと(Senri の `app.fetch` はいつも Promise を返し、Hono は同期のハンドラーなら Response をそのまま返す)は、前に VM で `serve()` の同期入口を試して、差が出ませんでした(2026-11-06、Bun 49,926 → 49,821、Deno 47,679 → 47,813 req/s)。なので主な理由ではないと見ています。causes の `hono-async` で、もう一度確かめます

### 5.2 Bun の static(約 0.9 倍)

- プロセスの中では、Senri と Hono はほぼ同じです(手元、2 ラウンド: Senri 2.2 µs、Hono 2.8 µs。ばらつきが大きい)。差は `Bun.serve` を通したときに出ています(**HTTP 側の疑い**)
- 疑っているのは Response の作り方です。Hono の static は init なしの `new Response(text)` で、Bun は Content-Type をネイティブの側で書くだけで済みます。Senri は Content-Type の入った Headers を渡すので、Bun はそれを写して書き出します
- Bun では、init なしの Response は Headers に Content-Type が入りません(`res.headers.get("content-type")` が `null`。Node と Deno は `text/plain;charset=UTF-8` が入る)。なので Senri がそのまま init なしに変えると、Content-Type を見るミドルウェア(compress など)が Bun でだけ違う動きになります
- **VM の結果待ち:** `bash perf-vm.sh causes` で、2 つの変種を Hono と比べます
  - `hono-async`: Hono の `fetch` を async で包み、いつも Promise を返すもの(Promise の分)
  - `hono-init`: ハンドラーが Senri と同じ `new Response(body, { status: 200, headers: <共有の Headers> })` を返すもの(Response の作り方の分)
  - `hono-init` が Hono より 1 割ほど遅ければ、Bun の差は Response の作り方で説明できます

---

## 6. 直す候補の一覧

効果が大きく、手間とリスクが小さい順に並べます。プロセスの中の数字は手元(Windows)のもので、7 ラウンドの中央値と最小〜最大です。上がる幅は、プロファイルとプロセスの中の差から見積もったもので、VM では確かめていません。

| # | 何をするか | 効きそうなランタイム | 上がりそうな幅 | 大きさ | 壊れる心配 | 手間 |
|---|---|---|---|---:|---|---|
| 1 | Node のアダプターで、`URL.canParse` を毎回呼ばない | Node(static・param) | +3〜5% | 0 B | 中 | 小 |
| 2 | `respond()` の HEAD の確かめを `methodOf(c)` にして、Node で Request を作らない | Node(利用者のミドルウェアがあるとき) | +5〜10%(自信なし) | +18 B | 小 | 小 |
| 3 | `c.header()` のあとの `c.json()` / `c.text()` / `c.html()` は、最初から全部のヘッダーを入れて作り、`finalize` で作り直さない | 全部(`c.header()` を使うミドルウェアがあるとき) | +10〜20%(自信なし) | +138 B | 中 | 中 |
| 4 | `splitPath` を、`split` を使わない 1 回の走査にする | 全部(パラメーターのあるルート) | +2〜4%(自信なし) | +64 B | 小 | 小 |
| 5 | Deno では、ヘッダーがなく 200 の文字列を `new Response(text)` で作る | Deno(static) | +5〜10%(自信なし) | +35 B | 中 | 小 |
| 6 | Bun でも、ミドルウェアも `c.header()` もないときは、文字列を `new Response(text)` で作る | Bun(static) | 最大 +10%(VM の causes の結果待ち) | +40 B ほど | 中 | 中 |
| 7 | Host を信頼する設定(`createApp({ trustHost: true })` など)を足し、Deno で Host を読まずに済むようにする | Deno | +5〜15%(自信なし) | +20 B ほど | 大 | 小 |

### 6.1 Node で `URL.canParse` を毎回呼ばない

- **何をするか:** `serveLazily` は、Request を作らない道でも、Request にしたら投げる URL を 400 にするため、毎回 `URL.canParse(url)` を呼んでいます。アダプターは Host とリクエストの対象をすでに自分で確かめているので、`URL.canParse` が落とすものだけを安く見分ける形にします
- **根拠:** Node の HTTP 経由のプロファイルで、`canParse` の self が static 5.0%、param 4.3% です
- **大きさ:** アダプター(`@senrijs/senri/node`)は本体の最小アプリに入らないので、0 B です
- **壊れる心配:** 中。`URL.canParse` が落とすもの(不正な Host の残り、ポートの範囲など)を取りこぼすと、Request を作ったときに初めて投げるようになります。今の 400 のテストを、Request を作らない道でも全部通す必要があります

### 6.2 Node で、HEAD の確かめのために Request を作らない

- **何をするか:** `app.ts` の `respond()` の `c.req.method !== "HEAD"` を `methodOf(c) !== "HEAD"`(`src/plain.ts`)にします。Node のアダプターから来たときは、Request を作らずにメソッドを読みます
- **根拠:** mw の Node のプロファイルで、`create`(Request を作る)が total 9.9%、undici の `_Request` が 8.2% です。このシナリオのハンドラーもミドルウェアも、`c.req` を読んでいません
- **大きさ:** +18 B(実験 N1)
- **壊れる心配:** 小。`methodOf` はメソッドを読むだけで、純正のミドルウェアがもう使っています
- 純正でないミドルウェアがあると Response を作る点は変わりません(これは #47 で決めたことです)

### 6.3 `c.header()` のあとに Response を作り直さない

- **何をするか:** `c.header()` で設定したヘッダーがあるとき、`c.json()` などで Response を作る時点で全部のヘッダーを入れます。その Response のあとに `c.header()` が呼ばれていなければ、`finalize` は何もしません。呼ばれていれば、増えた分だけをその Response に書き足します(Set-Cookie は増えた数だけ)
- **根拠:** プロセスの中で 1 回あたりの時間(ns):

  | | Bun mw | Deno mw |
  |---|---:|---:|
  | 今 | 14,948(11,478–20,752) | 27,414(21,911–38,263) |
  | 実験 E2 | 8,924(7,310–14,619) | 20,460(19,121–38,697) |

  プロファイルでも、`finalize` が total で Bun 34.6%、Deno 39.5% です
- **大きさ:** +138 B。**このままでは上限を 82 B 超えます。** 入れるなら、ほかを削るか、作り方を小さくする工夫が要ります
- **壊れる心配:** 中。ヘッダーを重ねる規則(Content-Type と Location はレスポンスのものが勝つ、Set-Cookie は足す)を、作り直しのときと同じに保つ必要があります。実験では、`c.header()` で Content-Type や Set-Cookie を決めた場合、`next()` のあとに足した場合、Response を直接返した場合、エラーの場合、404 の場合で、今と同じヘッダーになることを確かめました(最初の版は、あとから足すと Set-Cookie が 2 回付く誤りがあり、直しました)
- **手間:** 中。上の規則のテストを足す必要があります

### 6.4 `splitPath` を 1 回の走査にする

- **何をするか:** `pathname.split("/")` で配列を作ってから各セグメントで `includes("%")` を見る代わりに、文字を 1 回なめて、区切りと `%` を同時に見つけます
- **根拠:** プロセスの中で 1 回あたりの時間(ns):

  | | Bun param | Deno param |
  |---|---:|---:|
  | 今 | 3,000(2,330–13,270) | 5,102(3,956–9,201) |
  | 実験 E1 | 2,570(2,124–5,063) | 4,178(3,344–6,089) |

  プロファイルでは、`splitPath` が Bun の param で 17.1%、Deno の param で 8.9% です。HTTP では 1 リクエストのうち Senri の割合が小さいので、上がる幅は小さめに見ています
- **大きさ:** +64 B。**これ 1 つで上限を 8 B 超えます**
- **壊れる心配:** 小。でたらめなパス 2 万通り(`a / % 2 e F . b` の組み合わせ)と、境目の例(`/`、空、`//a//b/`、`%2F`、`%2e%2e`、不正な `%`)で、今と同じ結果(400 も含む)になることを確かめました

### 6.5 Deno で、ヘッダーのない文字列を `new Response(text)` で作る

- **何をするか:** Deno で動いていて、`c.header()` がなく、status が 200 のとき、`c.text()` は init なしの `new Response(text)` にします
- **根拠:** Response を作るだけなら 2.2 → 0.6 µs です(5.1)。プロセスの中の static は 1,704 → 965 ns(Deno、7 ラウンド)でした。HTTP では Deno の近道の op(`..._with_default_header`)も使えるようになります
- **大きさ:** +35 B
- **壊れる心配:** 中。Deno での Content-Type が `text/plain; charset=utf-8` から `text/plain;charset=UTF-8` になります(意味は同じ)。「どのランタイムでも同じ値を付ける」という今の決めごとから外れます。値をそのまま比べているテストや利用者のコードがあると変わります
- `{ status }` だけなら Deno では速いので、200 以外にも広げられます

### 6.6 Bun で、ミドルウェアのない文字列を `new Response(text)` で作る(causes の結果待ち)

- **何をするか:** Bun では、init なしの Response は Headers に Content-Type が入らないので、Content-Type を見る人がいないとき(ミドルウェアがなく、`c.header()` もない)だけ、init なしにします
- **根拠:** 5.2 の疑い。`hono-init` が Hono より遅ければ、ここで差が縮みます
- **壊れる心配:** 中。「ミドルウェアがないとき」を `respond()` に伝える仕組みが要り、ランタイムごとの分かれ道が増えます

### 6.7 Host を信頼する設定(候補には入れますが、勧めません)

- **何をするか:** Host を確かめるプロキシの後ろで動かすときに、Deno での Host の確かめを外せる設定を足します
- **根拠:** Deno の static で、Host の確かめが total 16.8% です
- **壊れる心配:** 大。設定を間違えると、パスのすり替え(5.1)を許します。「汎用的」という目標にも合わないので、勧めません

### 6.8 候補に入れなかったもの

- **`Context` を軽くする(実験 E3):** `error` と `route` の初期値をやめ、`params` の既定を共有の凍結したオブジェクトにしました。どのランタイムでも、ばらつきの中に収まって差が出ませんでした(Bun static 1,140 → 1,219 ns、Deno static 1,704 → 1,531 ns、幅が重なっている)
- **`app.fetch` を同期で返す:** 前に VM で `serve()` の同期入口を試して差が出ませんでした(5.1)。戻り値の型も変わります
- **グローバルの `Request` / `Response` を書き換える:** 前提のとおり入れません

### 6.9 大きさについて

実験ごとの大きさ(`bun run size` の「bun build・minify あり」と同じ形。今は 7,112 B):

| 実験 | gzip 後 | 差 |
|---|---:|---:|
| E1(`splitPath`) | 7,176 B | +64 B |
| E2(作り直しをしない) | 7,250 B | +138 B |
| E3(`Context`) | 7,115 B | +3 B |
| E4(Deno の text) | 7,147 B | +35 B |
| N1(`methodOf`) | 7,130 B | +18 B |

余裕は 56 B です。6.2(+18 B)と 6.5(+35 B)は、両方入れても +53 B で収まります(残り 3 B)。6.3 と 6.4 は、どこかを削らないと入りません。差は 1 つずつ足したときのもので、組み合わせると gzip の都合で少し変わります。

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

VM の結果待ち。

### 7.2 causes の結果

VM の結果待ち。

---

## 8. 手元での作業について

- 古い版を入れた場所と、実験のコピー(E1〜E4、N1)は、リポジトリの外の一時フォルダーに置き、終わったら消しました。src は変えていません
- プロファイル用のコードは bench の中だけにあります([`bench/perf-profile.ts`](../../bench/perf-profile.ts) など)。サーバーの `PROFILE_MS` は、指定したときだけ動きます
