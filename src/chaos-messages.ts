// chaos() がターミナルと /_senri に出す文言。en を元にして、ja は同じキーを必ず持つ
import type { Lang } from "./lang.ts";

const en = {
    on: "chaos() is ON: requests are slowed down and fail on purpose. Remove it or set enabled: false before deploying.",
    latency: "latency: {rate} of requests, {ms}",
    errors: "errors: {rate} of requests, status {status}",
    throws: "throws: {rate} of requests",
    seed: "seed: {seed} (pass seed: {seed} to break requests in the same order again)",
    header: "X-Senri-Chaos header: latency=<ms>, status=<400-599>, throw, none (comma-separated)",
    unknownEnv: "NODE_ENV cannot be read here, so chaos() cannot check that this is not production. Do not deploy it to production.",
    delayed: "delayed {req} by {ms} ms",
    responded: "responded {status} to {req}",
    threw: "threw an exception in {req}",
    delayedResponded: "delayed {req} by {ms} ms, then responded {status}",
    delayedThrew: "delayed {req} by {ms} ms, then threw an exception",
    byHeader: " (X-Senri-Chaos)",
    tag: "chaos",
};

/** A key of the messages of `chaos()`. */
export type ChaosMessageKey = keyof typeof en;

const ja: Record<ChaosMessageKey, string> = {
    on: "chaos() が有効です: リクエストをわざと遅らせたり、失敗させたりします。デプロイする前に外すか、enabled: false にしてください",
    latency: "遅延: リクエストの {rate} に {ms}",
    errors: "エラー: リクエストの {rate} に状態コード {status}",
    throws: "例外: リクエストの {rate} で投げる",
    seed: "シード: {seed}(seed: {seed} を渡すと、同じ順番で壊れます)",
    header: "X-Senri-Chaos ヘッダー: latency=<ミリ秒>、status=<400〜599>、throw、none(カンマ区切り)",
    unknownEnv: "ここでは NODE_ENV を読めないので、chaos() は本番かどうかを確かめられません。本番にデプロイしないでください",
    delayed: "{req} に {ms}ms の遅延を入れた",
    responded: "{req} で {status} を返した",
    threw: "{req} で例外を投げた",
    delayedResponded: "{req} に {ms}ms の遅延を入れてから、{status} を返した",
    delayedThrew: "{req} に {ms}ms の遅延を入れてから、例外を投げた",
    byHeader: "(X-Senri-Chaos ヘッダー)",
    tag: "カオス",
};

export const CHAOS_MESSAGES: Record<Lang, Record<ChaosMessageKey, string>> = { en, ja };
