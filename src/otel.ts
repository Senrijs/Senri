/**
 * OpenTelemetry tracing: a server span for each request, and, with `middlewareSpans: true`, a child span for each
 * middleware and the handler, so the onion timeline of development mode shows up in your production traces.
 *
 * Senri does not depend on OpenTelemetry: pass the `@opentelemetry/api` module you already use (and set up an SDK with
 * an exporter, as usual). Works on Bun, Deno, Node.js, Cloudflare Workers and browsers; on runtimes without an
 * OpenTelemetry context manager, spans are still created and nested, but your own spans are not parented to them.
 *
 * @example
 * ```ts
 * import * as api from "@opentelemetry/api";
 * import { createApp } from "@senrijs/senri";
 * import { otel } from "@senrijs/senri/otel";
 *
 * const app = createApp();
 * app.use(otel({ api, middlewareSpans: true }));
 * ```
 *
 * @module
 */
// OpenTelemetry のトレース。リクエストごとに server span を作り、middlewareSpans なら層(ミドルウェア・ハンドラー)ごとに子 span を作る
// Senri は OpenTelemetry に依存しない。使う人の @opentelemetry/api を受け取り、使うところだけを型に書く
import { observeLayers } from "./compose.ts";
import type { Context, Middleware } from "./context.ts";
import { headerOf, markPlainSafe, methodOf, urlOf } from "./plain.ts";

// --- @opentelemetry/api のうち、使うところ(構造だけ。Senri は import しない) ---

/** An OpenTelemetry context (opaque). */
export type OtelContext = unknown;

/** The part of an OpenTelemetry `Span` that {@link otel} uses. */
export type OtelSpan = {
    setAttribute(key: string, value: string | number | boolean): unknown;
    setStatus(status: { code: number; message?: string }): unknown;
    recordException(exception: unknown): unknown;
    updateName(name: string): unknown;
    end(): void;
};

/** The part of an OpenTelemetry `Tracer` that {@link otel} uses. */
export type OtelTracer = {
    startSpan(name: string, options?: { kind?: number; attributes?: Record<string, string | number | boolean> }, context?: OtelContext): OtelSpan;
};

/** The part of the `@opentelemetry/api` module that {@link otel} uses. Pass `import * as api from "@opentelemetry/api"`. */
export type OtelApi = {
    trace: {
        getTracer(name: string, version?: string): OtelTracer;
        setSpan(context: OtelContext, span: OtelSpan): OtelContext;
    };
    context: {
        active(): OtelContext;
        with<T>(context: OtelContext, fn: () => T): T;
    };
    propagation: {
        extract<C>(
            context: OtelContext,
            carrier: C,
            getter?: { get(carrier: C, key: string): string | string[] | undefined; keys(carrier: C): string[] },
        ): OtelContext;
    };
};

// SpanKind と SpanStatusCode の値(OpenTelemetry の仕様で決まっている)
const SPAN_KIND_SERVER = 1;
const SPAN_KIND_INTERNAL = 0;
const STATUS_ERROR = 2;

/** Options for {@link otel}. */
export type OtelOptions = {
    // import * as api from "@opentelemetry/api"
    /** The `@opentelemetry/api` module: `import * as api from "@opentelemetry/api"`. */
    api: OtelApi;
    /** The tracer. Default: `api.trace.getTracer("@senrijs/senri")`. */
    tracer?: OtelTracer;
    // 玉ねぎタイムライン: ミドルウェアとハンドラーごとに子 span を作る
    /**
     * Also create a child span for each middleware registered after `otel()`, and one for the handler, nested as they
     * run (the onion timeline of development mode, in production traces). Each span covers the layer and everything
     * inside it. Default `false`: only the server span.
     */
    middlewareSpans?: boolean;
};

// propagation.extract が Context からヘッダーを読むためのもの
const getter = {
    get: (c: Context, key: string) => headerOf(c, key) ?? undefined,
    keys: (c: Context) => [...c.req.headers.keys()],
};

/**
 * Middleware that traces each request with OpenTelemetry. Register it first so the server span covers everything.
 *
 * - The server span is named `GET /users/:id` (the route pattern; just the method when no route matched), continues
 *   the trace of an incoming `traceparent` (through `api.propagation`), and is active while the request is handled, so
 *   spans you create in handlers become its children (where a context manager is set up)
 * - Attributes follow the HTTP semantic conventions: `http.request.method`, `url.path`, `url.scheme`,
 *   `server.address`, `http.route`, `user_agent.original` and `http.response.status_code`
 * - 5xx responses and errors thrown in middleware or handlers mark the span as an error and record the exception
 * - `middlewareSpans: true` adds a child span per middleware (`middleware <name>`) and for the handler
 *   (`handler GET /users/:id`), each marked as an error when that layer threw
 *
 * @example
 * ```ts
 * import * as api from "@opentelemetry/api";
 * import { createApp } from "@senrijs/senri";
 * import { otel } from "@senrijs/senri/otel";
 *
 * const app = createApp();
 * app.use(otel({ api, middlewareSpans: true }));
 * app.get("/users/:id", ({ id }) => ({ id }));
 * ```
 */
export function otel(options: OtelOptions): Middleware {
    const { api } = options;
    const tracer = options.tracer ?? api.trace.getTracer("@senrijs/senri");

    return markPlainSafe<Middleware>(async function otel(c, next) {
        const method = methodOf(c);
        const url = new URL(urlOf(c));
        const attributes: Record<string, string | number> = {
            "http.request.method": method,
            "url.path": url.pathname,
            "url.scheme": url.protocol.slice(0, -1),
            "server.address": url.hostname,
        };
        const userAgent = headerOf(c, "user-agent");
        if (userAgent !== null) attributes["user_agent.original"] = userAgent;
        if (c.route !== undefined) attributes["http.route"] = c.route;
        const name = c.route === undefined ? method : `${method} ${c.route}`;

        const parent = api.propagation.extract(api.context.active(), c, getter);
        const span = tracer.startSpan(name, { kind: SPAN_KIND_SERVER, attributes }, parent);
        const active = api.trace.setSpan(parent, span);
        if (options.middlewareSpans) observeLayers(c, layerSpans(api, tracer, c, active, name));

        try {
            const res = await api.context.with(active, next);
            span.setAttribute("http.response.status_code", res.status);
            // ハンドラーやミドルウェアの例外は onError がレスポンスにするので、c.error で知る
            if (c.error !== undefined) span.recordException(c.error);
            if (res.status >= 500) span.setStatus({ code: STATUS_ERROR });
            return res;
        } catch (err) {
            // onError も失敗したときなど
            span.recordException(err);
            span.setStatus({ code: STATUS_ERROR });
            throw err;
        } finally {
            span.end();
        }
    });
}

// 層ごとの子 span。層は入れ子(玉ねぎ)なので、いま開いている span を積んでおき、いちばん上を親にする
function layerSpans(api: OtelApi, tracer: OtelTracer, c: Context, root: OtelContext, handlerName: string) {
    const stack: OtelContext[] = [root];
    return (layer: string | undefined) => {
        const parent = stack[stack.length - 1];
        const span = tracer.startSpan(
            layer === undefined ? `handler ${handlerName}` : `middleware ${layer}`,
            { kind: SPAN_KIND_INTERNAL, attributes: layer === undefined ? {} : { "senri.middleware": layer } },
            parent,
        );
        const context = api.trace.setSpan(parent, span);
        stack.push(context);
        return (failed: boolean) => {
            if (failed) {
                span.setStatus({ code: STATUS_ERROR });
                if (c.error !== undefined) span.recordException(c.error);
            }
            span.end();
            const index = stack.lastIndexOf(context);
            if (index > 0) stack.splice(index, 1);
        };
    };
}
