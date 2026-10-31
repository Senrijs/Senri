// ヘルスチェック(Kubernetes の liveness / readiness probe や、ロードバランサー向け)
//
// app.use(health({ ready: () => db.isConnected() }))
// - GET /healthz: プロセスが応答できれば 200(liveness。ここが落ちたら再起動してよい)
// - GET /readyz: リクエストを受けられる状態なら 200、そうでなければ 503(readiness。外れている間は振り分けられない)
//   ready() が false を返したとき・例外を投げたとき・serve() が止まり始めたあとは 503
// どちらも、ほかのミドルウェア(認証など)より先に app.use() すると、そちらを通らずに答えられる
import type { Middleware } from "./context.ts";

/** Options for {@link health}. */
export type HealthOptions = {
    // 省略すると "/healthz" と "/readyz"。false にすると、そのエンドポイントを出さない
    /** The liveness path. Default `"/healthz"`; `false` disables it. */
    path?: string | false;
    /** The readiness path. Default `"/readyz"`; `false` disables it. */
    readyPath?: string | false;
    // リクエストを受けられるか(DB につながっているか、など)。省略すると、止まり始めるまで常に受けられる
    /**
     * Whether the app can take requests (connected to the database, for example).
     * Returning `false` or throwing makes the readiness check answer 503. Without it, the app is ready until it starts shutting down.
     */
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

/**
 * Middleware that answers health checks (Kubernetes probes, load balancers) for GET and HEAD.
 * Responses are plain text with `Cache-Control: no-store`; other requests go on to `next()`.
 * - Liveness (`/healthz`): always 200 `ok`
 * - Readiness (`/readyz`): 200 `ready`, or 503 when `ready()` returns `false` or throws (`not ready`),
 *   or after `serve()` from `@senrijs/senri/serve` starts shutting down (`shutting down`).
 *   The `serve()` from `@senrijs/senri/node` does not do this.
 *
 * Register it before middleware such as authentication so probes do not go through it.
 *
 * @example
 * ```ts
 * import { createApp, health } from "@senrijs/senri";
 *
 * const app = createApp();
 * let connected = true;
 * app.use(health({ ready: () => connected }));
 * ```
 */
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
