// プレイグラウンドの Worker。利用者が書いたコードを、ブラウザの中で本物の Senri(開発モード)で動かす
// scripts/build-worker.ts が、これを public/playground/worker.js にまとめる(リポジトリの src をそのまま使う)
//
// 安全のための決まり:
// - Worker の中だけで動かす(ページの DOM、Cookie、localStorage には届かない)
// - 外へは通信させない: このファイルには CSP(default-src 'none')を付けて返す(public/_headers)。
//   念のため、コードを動かす前に fetch や WebSocket などを消しておく
// - import できるのは @senrijs/senri とそのサブパスだけ
// - 時間切れはページの側(components/home/demo.tsx)で見て、Worker ごと止める
// - 返す本文は 100 KB まで
import { transform } from "sucrase";
import * as senri from "../../../src/index.ts";
import { devtools } from "../../../src/dev/index.ts";
import { hintFor } from "../../../src/dev/hints.ts";
import { hintCode, hintText } from "../../../src/dev/messages.ts";
import * as cookie from "../../../src/cookie.ts";
import * as streaming from "../../../src/streaming.ts";
import * as multipart from "../../../src/multipart.ts";
import * as problem from "../../../src/problem.ts";

const MAX_BODY = 100 * 1024;
const FILE = "app.ts";

type Lang = "ja" | "en";
// port: serve() の既定のポート(ページが、ビルドのときのデータから渡す)
type Request_ = { id: number; code: string; method: string; path: string; lang: Lang; port: number };

// 外へ通信できるものを消す(CSP が本当の守り。これは念のため)
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel"]) {
    try {
        Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
    } catch {
        // 消せないものは、CSP に任せる
    }
}

let lastError: unknown;
// c.error を受け取るため、作ったアプリの先頭にミドルウェアを1つ足す
const createApp = ((options?: Parameters<typeof senri.createApp>[0]) => {
    const app = senri.createApp(options);
    app.use(async (c, next) => {
        const res = await next();
        lastError = c.error;
        return res;
    });
    return app;
}) as typeof senri.createApp;

const MODULES: Record<string, unknown> = {
    "@senrijs/senri": { ...senri, createApp },
    "@senrijs/senri/dev": { devtools },
    "@senrijs/senri/cookie": cookie,
    "@senrijs/senri/streaming": streaming,
    "@senrijs/senri/multipart": multipart,
    "@senrijs/senri/problem": problem,
};

// new Function は前に行を足すので、スタックの行番号から引く数を、このブラウザで調べる
const LINE_OFFSET = (() => {
    try {
        new Function("throw new Error()\n//# sourceURL=probe.ts")();
    } catch (err) {
        const line = /probe\.ts:(\d+)/.exec(String((err as Error).stack))?.[1];
        if (line) return Number(line) - 1;
    }
    return 0;
})();

const lineOf = (err: unknown) => {
    const line = new RegExp(`${FILE.replace(".", "\\.")}:(\\d+)`).exec(String((err as Error)?.stack ?? ""))?.[1];
    return line ? Number(line) - LINE_OFFSET : null;
};

// 同じコードなら、アプリを作り直さない
let cached: { code: string; app: { fetch(req: Request): Promise<Response> } } | null = null;

function build(code: string) {
    if (cached?.code === code) return cached.app;
    const js = transform(code, { transforms: ["typescript", "imports"], filePath: FILE }).code;
    const module = { exports: {} as Record<string, unknown> };
    const require = (id: string) => {
        if (id in MODULES) return MODULES[id];
        throw new Error(`Cannot import "${id}" in the playground. Only @senrijs/senri is available.`);
    };
    new Function("require", "module", "exports", `${js}\n//# sourceURL=${FILE}`)(require, module, module.exports);
    const app = module.exports.default as { fetch?: unknown } | undefined;
    if (!app || typeof app.fetch !== "function") throw new Error("Export the app with `export default app;`.");
    cached = { code, app: app as { fetch(req: Request): Promise<Response> } };
    return cached.app;
}

function errorInfo(err: unknown, lang: Lang) {
    const e = err instanceof Error ? err : new Error(String(err));
    const hint = hintFor(e);
    return {
        name: e.name,
        message: e.message,
        line: lineOf(e),
        hint: hint ? hintText(hint, lang) : null,
        hintCode: hint ? (hintCode(hint, lang) ?? null) : null,
    };
}

self.onmessage = async (event: MessageEvent<Request_>) => {
    const { id, code, method, path, lang, port } = event.data;
    const reply = (data: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...data });
    let app;
    try {
        app = build(code);
    } catch (err) {
        // 書き方の間違い(変換できない、import できない、export がない)
        return reply({ kind: "build", error: errorInfo(err, lang) });
    }
    try {
        lastError = undefined;
        const url = `http://localhost:${port}${path.startsWith("/") ? path : `/${path}`}`;
        const res = await app.fetch(new Request(url, { method, headers: { "accept-language": lang } }));
        let body = await res.text();
        const truncated = body.length > MAX_BODY;
        if (truncated) body = body.slice(0, MAX_BODY);
        reply({
            kind: "response",
            recording: {
                method,
                path,
                status: res.status,
                statusText: res.statusText,
                type: res.headers.get("content-type"),
                location: res.headers.get("location"),
                body: body === "" ? null : body,
                error: lastError === undefined ? null : errorInfo(lastError, lang),
            },
            truncated,
        });
    } catch (err) {
        reply({ kind: "build", error: errorInfo(err, lang) });
    }
};
