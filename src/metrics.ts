/**
 * Prometheus metrics for HTTP requests: a duration histogram and the number of requests in progress, labeled by
 * method, route pattern and status, served in the Prometheus text format.
 *
 * @example
 * ```ts
 * import { createApp, ipRestriction } from "@senrijs/senri";
 * import { metrics, metricsHandler } from "@senrijs/senri/metrics";
 *
 * const app = createApp();
 * app.use(metrics());
 * app.use("/metrics", ipRestriction({ allow: ["10.0.0.0/8"] }));
 * app.get("/metrics", metricsHandler());
 * ```
 *
 * @module
 */
// Prometheus のメトリクス(HTTP のリクエストだけ)。記録はプロセスのメモリ(Workers では isolate ごと)
// ラベルの数が増えすぎないよう、パスではなくルートのパターンを使い、知らないメソッドは _OTHER にまとめる
import type { Context, Middleware } from "./context.ts";
import { senriError } from "./errors.ts";
import { markPlainSafe, methodOf } from "./plain.ts";

/** Options for {@link metrics}. */
export type MetricsOptions = {
    // ヒストグラムのバケットの上限(秒)。小さい順
    /**
     * The upper bounds, in seconds, of the duration histogram's buckets, in increasing order.
     * Default: the OpenTelemetry HTTP buckets, from 5 ms to 10 s.
     */
    buckets?: readonly number[];
};

// OpenTelemetry の http.server.request.duration の推奨バケット
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

// ラベルに使うメソッド。ほかは _OTHER(勝手なメソッド名でラベルを増やされないように。OpenTelemetry と同じ)
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "QUERY", "CONNECT", "TRACE"]);
// ルートがなかったもの(404 など)。ルートのパターンは "/" で始まるので、まぎれない
const UNMATCHED = "unmatched";

type Series = { method: string; route: string; status: string; counts: number[]; sum: number; count: number };

// プロセスで 1 つ(metrics() と metricsHandler() が共有する)
let buckets: readonly number[] = DEFAULT_BUCKETS;
const series = new Map<string, Series>();
const active = new Map<string, number>();

const methodLabel = (c: Context) => {
    const method = methodOf(c);
    return METHODS.has(method) ? method : "_OTHER";
};

function record(method: string, route: string, status: number, seconds: number): void {
    const key = `${method} ${route} ${status}`;
    let s = series.get(key);
    if (!s) {
        s = { method, route, status: String(status), counts: new Array(buckets.length).fill(0), sum: 0, count: 0 };
        series.set(key, s);
    }
    // いちばん小さい、seconds 以上のバケットに 1 足す(書き出すときに累積する)
    const index = buckets.findIndex((upper) => seconds <= upper);
    if (index !== -1) s.counts[index]!++;
    s.sum += seconds;
    s.count++;
}

/**
 * Middleware that records every request it covers. Register it once, first, so it measures everything; serve the
 * result with {@link metricsHandler}.
 *
 * - `http_server_request_duration_seconds` (histogram): from entering this middleware until the response is returned
 *   (a streamed body may still be sending), labeled `method`, `route` and `status`
 * - `http_server_active_requests` (gauge): requests in progress, labeled `method`
 *
 * To keep the number of series small, `route` is the route pattern (`/users/:id`, not `/users/42`), `unmatched` when no
 * route matched, and methods other than the standard ones are counted as `_OTHER`. Errors turned into responses by
 * `onError` count with their status (500).
 *
 * Metrics live in the process's memory; on Cloudflare Workers, each isolate has its own.
 * Throws a `RangeError` if `buckets` is empty, not increasing, or has a value that is not a positive finite number.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { metrics, metricsHandler } from "@senrijs/senri/metrics";
 *
 * const app = createApp();
 * app.use(metrics({ buckets: [0.01, 0.1, 1] }));
 * app.get("/metrics", metricsHandler());
 * ```
 */
export function metrics(options: MetricsOptions = {}): Middleware {
    if (options.buckets !== undefined) {
        const list = options.buckets;
        const valid =
            Array.isArray(list) &&
            list.length > 0 &&
            list.every((b, i) => typeof b === "number" && Number.isFinite(b) && b > 0 && (i === 0 || b > list[i - 1]!));
        if (!valid) throw senriError("metrics_buckets", new RangeError("metrics(): buckets must be positive numbers in increasing order"));
        // バケットを変えたら、これまでの記録は形が合わないので捨てる
        if (list.join() !== buckets.join()) series.clear();
        buckets = [...list];
    }

    return markPlainSafe<Middleware>(async function metrics(c, next) {
        const method = methodLabel(c);
        const start = performance.now();
        active.set(method, (active.get(method) ?? 0) + 1);
        let status = 500;
        try {
            const res = await next();
            status = res.status;
            return res;
        } finally {
            active.set(method, active.get(method)! - 1);
            record(method, c.route ?? UNMATCHED, status, (performance.now() - start) / 1000);
        }
    });
}

// ラベルの値のエスケープ(Prometheus のテキスト形式: \ と " と改行)
const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

/**
 * A handler that answers with the metrics recorded by {@link metrics}, in the Prometheus text format
 * (`text/plain; version=0.0.4`). Anyone who can reach it sees your routes and traffic, so protect it, for example with
 * `ipRestriction()` or `basicAuth()`.
 *
 * @example
 * ```ts
 * import { basicAuth, createApp } from "@senrijs/senri";
 * import { metrics, metricsHandler } from "@senrijs/senri/metrics";
 *
 * const app = createApp();
 * app.use(metrics());
 * app.use("/metrics", basicAuth({ username: "prometheus", password: process.env.METRICS_PASSWORD! }));
 * app.get("/metrics", metricsHandler());
 * ```
 */
export function metricsHandler(): (params: any, c: Context) => Response {
    return () => {
        const lines = [
            "# HELP http_server_request_duration_seconds Duration of HTTP server requests.",
            "# TYPE http_server_request_duration_seconds histogram",
        ];
        for (const s of series.values()) {
            const labels = `method="${escape(s.method)}",route="${escape(s.route)}",status="${s.status}"`;
            let cumulative = 0;
            buckets.forEach((upper, i) => {
                cumulative += s.counts[i]!;
                lines.push(`http_server_request_duration_seconds_bucket{${labels},le="${upper}"} ${cumulative}`);
            });
            lines.push(`http_server_request_duration_seconds_bucket{${labels},le="+Inf"} ${s.count}`);
            lines.push(`http_server_request_duration_seconds_sum{${labels}} ${s.sum}`);
            lines.push(`http_server_request_duration_seconds_count{${labels}} ${s.count}`);
        }
        lines.push("# HELP http_server_active_requests Number of HTTP server requests in progress.");
        lines.push("# TYPE http_server_active_requests gauge");
        for (const [method, count] of active) lines.push(`http_server_active_requests{method="${escape(method)}"} ${count}`);
        return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" } });
    };
}

/** Clears everything recorded so far (for tests). */
export function resetMetrics(): void {
    series.clear();
    active.clear();
}
