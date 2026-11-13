#!/usr/bin/env bash
# 速度の調査(docs/design/perf-0.3.md)を、ベンチ用の VM で測る
# Senri と Hono を交互に wrk で測り、「Hono に対して何倍か」を出す(bench/perf-abab.ts)
#
# 使い方(bench で。先に bun install --frozen-lockfile):
#   bash perf-vm.sh main        # Bun / Node.js / Deno × static / param / mw。今の src と raw を Hono と比べる(約 14 分)
#   bash perf-vm.sh main bun    # 1 つのランタイムだけ(約 5 分)
#   bash perf-vm.sh versions    # Bun で 0.2.8 / 0.2.9 / 0.2.10 / 0.3.1 / 今の src を Hono と比べる(約 9 分)
#
# - 古い版は、リポジトリの外の一時フォルダーに npm から入れて、終わったら消す(VERSIONS_DIR を渡せばそこを使い、消さない)
# - 条件は環境変数で変えられる(bench/perf-abab.ts の頭を参照)。既定は 1 回 6 秒、3 ラウンド
# - ログは perf-<日時>.txt に、生の値は results/perf-*.json に残る
set -euo pipefail
cd "$(dirname "$0")"

mode="${1:-main}"
log="perf-$(date +%Y%m%d-%H%M%S).txt"
echo "wrk: $(wrk -v 2>&1 | head -1)" | tee "$log"

case "$mode" in
main)
    runtimes="${2:-bun node deno}"
    for rt in $runtimes; do
        RUNTIME="$rt" TARGETS="${TARGETS:-senri}" bun perf-abab.ts 2>&1 | tee -a "$log"
    done
    ;;
versions)
    if [ -z "${VERSIONS_DIR:-}" ]; then
        VERSIONS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/senri-versions.XXXXXX")"
        trap 'rm -rf "$VERSIONS_DIR"' EXIT
    fi
    export VERSIONS_DIR
    list="${VERSIONS:-0.2.8 0.2.9 0.2.10 0.3.1}"
    deps=""
    targets=""
    for v in $list; do
        deps="$deps senri-$v@npm:@senrijs/senri@$v"
        targets="$targets,senri@$v"
    done
    (cd "$VERSIONS_DIR" && echo '{"private":true,"type":"module"}' > package.json && bun add $deps >/dev/null)
    # src は今のリポジトリ(0.3.1 との差を見るため)
    RUNTIME="${RUNTIME:-bun}" TARGETS="${targets#,},senri" SCENARIOS="${SCENARIOS:-static,param}" ROUNDS="${ROUNDS:-3}" \
        bun perf-abab.ts 2>&1 | tee -a "$log"
    ;;
*)
    echo "使い方: bash perf-vm.sh main [bun|node|deno] / bash perf-vm.sh versions" >&2
    exit 1
    ;;
esac
echo "ログ: $log"
