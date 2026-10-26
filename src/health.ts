// ヘルスチェック(Kubernetes の liveness / readiness probe や、ロードバランサー向け)
//
// app.use(health({ ready: () => db.isConnected() }))
// - GET /healthz: プロセスが応答できれば 200(liveness。ここが落ちたら再起動してよい)
// - GET /readyz: リクエストを受けられる状態なら 200、そうでなければ 503(readiness。外れている間は振り分けられない)
//   ready() が false を返したとき・例外を投げたとき・serve() が止まり始めたあとは 503
// どちらも、ほかのミドルウェア(認証など)より先に app.use() すると、そちらを通らずに答えられる
import type { Middleware } from "./context.ts";

export type HealthOptions = {
    // 省略すると "/healthz" と "/readyz"。false にすると、そのエンドポイントを出さない
    path?: string | false;
    readyPath?: string | false;
    // リクエストを受けられるか(DB につながっているか、など)。省略すると、止まり始めるまで常に受けられる
    ready?: () => boolean | Promise<boolean>;
};

// serve() が止まり始めた(SIGTERM などを受けた)か。プロセス全体で1つ
let draining = false;

export function setDraining(value: boolean): void {
    draining = value;
}

export function isDraining(): boolean {
    return draining;
}

const plain = (body: string, status: number) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export function health(options: HealthOptions = {}): Middleware {
    const live = options.path === undefined ? "/healthz" : options.path;
    const ready = options.readyPath === undefined ? "/readyz" : options.readyPath;

    return async function health(c, next) {
        const method = c.req.method;
        if (method !== "GET" && method !== "HEAD") return next();
        let path: string;
        try {
            path = c.path;
        } catch {
            return next();
        }
        if (path === live) return plain("ok", 200);
        if (path !== ready) return next();

        if (draining) return plain("shutting down", 503);
        try {
            if (options.ready && !(await options.ready())) return plain("not ready", 503);
        } catch {
            // 確かめる処理が失敗したなら、受けられるとは言えない(中身は外に出さない)
            return plain("not ready", 503);
        }
        return plain("ready", 200);
    };
}
