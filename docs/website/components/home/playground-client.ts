"use client";
// プレイグラウンドの Worker(public/playground/worker.js)を動かす側
// - Worker は、最初に要るとき(コードを書き換えて送ったとき、記録にないパスを送ったとき)に初めて作る
// - 2 秒で返事がなければ、Worker ごと止めて(無限ループも止まる)、次に送るときに作り直す
import type { Recording } from "@/lib/home/types";
import type { Lang } from "@/lib/i18n";

const TIMEOUT_MS = 2000;
const URL_ = "/playground/worker.js";

export type RunError = NonNullable<Recording["error"]>;
export type RunResult =
    | { kind: "response"; recording: Recording; truncated: boolean }
    | { kind: "build"; error: RunError }
    | { kind: "timeout" }
    | { kind: "unavailable" };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: RunResult) => void>();

function getWorker(): Worker | null {
    if (worker) return worker;
    try {
        worker = new Worker(URL_, { type: "module", name: "senri-playground" });
    } catch {
        return null;
    }
    worker.onmessage = (e: MessageEvent<{ id: number } & RunResult>) => {
        const done = pending.get(e.data.id);
        if (!done) return;
        pending.delete(e.data.id);
        done(e.data);
    };
    worker.onerror = () => {
        // 読み込めなかった(CSP やネットワーク)とき: 待っているものを全部終わらせる
        for (const [id, done] of pending) {
            pending.delete(id);
            done({ kind: "unavailable" });
        }
        stop();
    };
    return worker;
}

function stop() {
    worker?.terminate();
    worker = null;
}

export function run(input: { code: string; method: string; path: string; lang: Lang; port: number }): Promise<RunResult> {
    const w = getWorker();
    if (!w) return Promise.resolve({ kind: "unavailable" });
    const id = nextId++;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            stop();
            resolve({ kind: "timeout" });
        }, TIMEOUT_MS);
        pending.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
        });
        w.postMessage({ id, ...input });
    });
}
