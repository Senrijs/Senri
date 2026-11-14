# ベンチマーク

Senri・Hono・Elysia を同じ条件で比べます。依存はこのディレクトリの中だけで、バージョンは `package.json` で固定しています。

```sh
cd bench
bun install
bun run router     # ルーターだけ(Request も Response も作らない)
bun run fetch      # app.fetch をプロセスの中で直接呼ぶ(ネットワークなし)
bun run http       # サーバーを立てて wrk で負荷をかける(Bun)
bun run http:node  # 同じく Node.js
bun run http:deno  # 同じく Deno
bun run http:all   # Bun → Node.js → Deno の順に全部
```

## 条件

- どのフレームワークも本番モード、ミドルウェアなし、ハンドラーはテキストを返すだけ
- ルートは 12 個、リクエストは 8 種類(`apps.ts`)。最初に、全部のフレームワークが同じ status と本文を返すことを確かめてから測ります
- `http` は、負荷をかける側(`http.ts`)をいつも Bun で動かし、サーバーだけを測るランタイムで別のプロセスに立てます

### サーバーの立て方

| ランタイム | Senri | Hono | Elysia | raw(上限の目安) |
|---|---|---|---|---|
| Bun(`server.ts`) | `Bun.serve({ fetch })` | `Bun.serve({ fetch })` | `Bun.serve({ fetch })` | `Bun.serve` |
| Node.js(`server-node.ts`) | `@senrijs/senri/node` の `serve` | `@hono/node-server` | `@elysiajs/node` のアダプター | `node:http` |
| Deno(`server-deno.ts`) | `Deno.serve(fetch)` | `Deno.serve(fetch)` | `Deno.serve(fetch)` | `Deno.serve` |

- **raw:** フレームワークなしで、測るリクエストの「メソッド + パス」から答えを引く表で返します。ルーターを通らない、上限の目安です
- **senri-0.2.9(Node.js だけ):** Node の近道(#44・#46・#47)より前の版を、npm から別名で入れて同じ回に測ります。今の Senri と比べて、何倍になったかを確かめるためです
- Bun では、Elysia の `listen()` や Bun の `routes` は使わず、どれも同じ `Bun.serve({ fetch })` にそろえています

### 測り方

- [wrk](https://github.com/wg/wrk) が必要です。PATH にないときは、環境変数 `WRK` に実行ファイルのパスを入れます
- サーバーを全部先に立てておき、同じリクエストを順番を変えながら交互に測って、中央値を出します
- 測る前に、どのサーバーも同じ status と本文を返すことを `fetch` で確かめます
- 負荷をかけている間に、期待と違う応答(200 を期待して 2xx・3xx 以外、404 を期待して 2xx・3xx)や接続のエラーが 1 つでもあったら、その数字は使わずにエラーにします

#### wrk の結果の読み取り方

wrk は JSON を出さないので、表示の文字を読むのではなく、Lua スクリプト([`wrk.lua`](wrk.lua))で出させます。

- `http.ts` は `wrk -s wrk.lua` で動かし、メソッドは環境変数 `WRK_METHOD` で渡します
- `wrk.lua` の `done()` が、終わったときに `WRK_JSON {...}` の 1 行を出します。中身は、リクエスト数・かかった時間(µs)・受け取ったバイト数・エラーの数(connect / read / write / timeout と、2xx・3xx 以外の応答の数)・レイテンシの p50 と p99(µs)です
- `http.ts` はその行を探して読み、req/s を「リクエスト数 ÷ かかった時間」で出します。行が見つからないときや、wrk が 0 以外で終わったときは、wrk の出力をそのまま見せてエラーにします
- 表示の文字(`Requests/sec:` など)は単位の付き方が版で変わることがあるので、読みません
- 環境変数で条件を変えられます

| 変数 | 既定 | 中身 |
|---|---|---|
| `RUNTIME` | `bun` | `bun` / `node` / `deno` |
| `DURATION` | `10s` | 1 回の負荷の長さ |
| `CONNECTIONS` | `64` | 同時接続数 |
| `WRK_THREADS` | `4` | wrk のスレッド数(固定するコアの数に合わせる) |
| `ROUNDS` | `3` | 交互に測る回数(中央値を出す) |
| `FRAMEWORKS` | ランタイムごと | 例: `senri,hono` |
| `PIN` | 固定する | `0` でコアを固定しない |
| `SERVER_CPUS` / `WRK_CPUS` | `0-3` / `4-7` | サーバーと wrk を固定するコア(Linux で `taskset` があるとき) |

- 結果は、最後に Markdown の表を出し、生の値を `results/<ランタイム>-<日時>.json` に書きます(`results/` は Git に入れません)

## ベンチ用の VM で測る(Ubuntu、EPYC 8 コア、メモリ 10 GiB)

負荷をかける側とサーバーが同じマシンで動くので、コアを分けて固定します(サーバーは 0〜3、wrk は 4〜7)。

### 1. 入れるもの

版を固定して入れます(ベンチ用の VM で測った版)。

```sh
sudo apt-get update && sudo apt-get install -y git curl unzip util-linux wrk   # taskset は util-linux に入っている

# Bun 1.4.4
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"

# Node.js 24.22.2(nvm で入れる)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 24.22.2

# Deno 2.9.8
curl -fsSL https://deno.land/install.sh | sh -s v2.9.8

# 新しいシェルを開くか、PATH を読み直す
exec $SHELL -l
bun --version && node --version && deno --version && wrk -v
```

- wrk は Ubuntu のパッケージ(`apt-get install wrk`)を使います(Ubuntu 24.04 では 4.1.0、`debian/4.1.0-4build2`)。`wrk -v` で出る版を、結果といっしょに残してください(`wrk -v` は 0 以外で終わることがありますが、版が出ていれば大丈夫です)

### 2. 測る

```sh
git clone https://github.com/Senrijs/Senri.git && cd Senri/bench
bun install --frozen-lockfile
ROUNDS=5 DURATION=15s bun run http:all 2>&1 | tee http-$(date +%Y%m%d).txt
```

- かかる時間の目安は、この条件で 70 分ほどです(Bun 約 21 分、Node.js 約 26 分、Deno 約 21 分)。既定(`ROUNDS=3 DURATION=10s`)なら 30 分ほどです
- 測っている間は、ほかの重い処理を動かさないでください
- 1 つのランタイムだけ測るときは、`bun run http:node` のように動かします

### 3. 結果の出し方

- それぞれのランタイムの最後に、次のような表が出ます。表をそのまま貼れば、比べられます

```
Node.js v24.22.2 / AMD EPYC ... x 8 / wrk -t4 -c64 -d15s / 5 rounds (median) / server on CPU 0-3, wrk on CPU 4-7

| | senri | senri-0.2.9 | hono | elysia | raw |
|---|---:|---:|---:|---:|---:|
| static (short) | ... |
```

- 細かい値(ラウンドごとの req/s)は `results/*.json` にあります

## Hono との比べ方と、版ごとの比べ方(速度の調査)

[docs/design/perf-0.3.md](../docs/design/perf-0.3.md) の調査で使うものです。上の `http` と違い、Senri と Hono を交互に測って「Hono に対して何倍か」を出します。ほかの VM の負荷で数字がぶれても比べられるようにするためです。

```sh
bash perf-vm.sh main       # Bun / Node.js / Deno × static / param / mw。今の src と raw を Hono と比べる(約 14 分)
bash perf-vm.sh causes     # Hono との差の切り分け(hono-async / hono-init。約 11 分)
bash perf-vm.sh versions   # Bun で公開済みの版を比べる(約 9 分)
bash perf-vm.sh compare    # main と今のブランチを、ランタイムごとに Hono と比べる(約 12 分。raw は測らない)
```

| ファイル | 中身 |
|---|---|
| `scenarios.ts` | 3 つのシナリオ(static / param / mw)の Senri・Hono のアプリと、差を切り分けるための Hono の変種 |
| `perf-serve.ts` | シナリオのサーバー。ランタイムを見て `Bun.serve` / `Deno.serve` / Node のアダプターで立てる |
| `perf-abab.ts` | 「Hono, A, Hono, B, …」の順に wrk で測り、すぐ前後の Hono との比を出す。raw も毎ラウンド測って、頭打ちを見分ける |
| `perf-vm.sh` | VM でそのまま動かす入口。古い版は一時フォルダーに入れて、終わったら消す |
| `versions.ts` | 版どうし(と Hono)を、プロセスの中で `app.fetch` を呼んで比べる。どのランタイムでも動く |
| `perf-profile.ts` | プロセスの中で `app.fetch` を回して CPU プロファイルを取る |
| `perf-profile-http.ts` | サーバーを立てて要求を流し、そのあいだのサーバーの CPU プロファイルを取る(送る側の数字は使わない) |
| `perf-profile-summary.ts` | `.cpuprofile` を、分類ごと・関数ごとの割合の表にまとめる |

- 古い版を手元で比べるときは、リポジトリの外のフォルダーに npm から別名で入れて(`bun add senri-0.2.9@npm:@senrijs/senri@0.2.9`)、そのフォルダーを `VERSIONS_DIR` に渡します。例: `VERSIONS_DIR=/tmp/v VERSIONS=0.2.9,src bun versions.ts`
- Bun のプロファイルは、HTTP 経由で取ると待っている時間まで JS の関数に付いてしまうので、`perf-profile.ts`(プロセスの中)で取ります
- Windows でサンプリングを 100 µs にすると、サーバーが極端に遅くなります。既定の 1000 µs のままにしてください

## 結果

ベンチ用の VM で測った結果を、ここに載せます(まだ測っていません)。

> **Elysia について:** Elysia の本命は Bun です。Node.js では `@elysiajs/node` のアダプター経由、Deno では `Deno.serve(fetch)` で動かしているので、Bun 以外の数字は Elysia の得意な形ではありません。

## 読み方の注意

- Senri はテキストを返すとき、どのランタイムでも同じになるよう `Content-Type: text/plain; charset=utf-8` を自分で付けます。Hono と Elysia はランタイムに任せる(`new Response(text)`)ので、そのぶん Senri が不利です
- Elysia は登録したルートからコードを生成して最適化します(`compile()`)。Senri は Cloudflare Workers でも動くよう、`new Function` / `eval` を使いません
- Node.js の Senri は、`@senrijs/senri/node` の近道(ハンドラーが文字列や JSON を返すとき、Request も Response も作らない)が効く形で測っています
