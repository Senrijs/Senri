import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as api from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { createApp } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { otel, type OtelOptions } from "../src/otel.ts";
import { isPlainSafe } from "../src/plain.ts";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const tracer = provider.getTracer("test");

beforeAll(() => {
    api.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    api.propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});
afterEach(() => exporter.reset());

function makeApp(options: Partial<OtelOptions> = {}, dev = false) {
    const app = createApp(dev ? { dev: devtools({ lang: "en" }) } : {});
    app.use(otel({ api, tracer, ...options }));
    return app;
}

const req = (path: string, init?: RequestInit) => new Request(`http://example.com${path}`, init);
const spans = () => exporter.getFinishedSpans();
const byName = (name: string) => spans().find((s) => s.name === name)!;
const parentOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;

describe("otel()", () => {
    test("server span: 名前はルートのパターン、HTTP の属性、status", async () => {
        const app = makeApp();
        app.get("/users/:id", ({ id }) => ({ id }));
        await app.fetch(req("/users/42?x=1", { headers: { "user-agent": "test-agent" } }));
        const [span] = spans();
        expect(span!.name).toBe("GET /users/:id");
        expect(span!.kind).toBe(api.SpanKind.SERVER);
        expect(span!.attributes).toEqual({
            "http.request.method": "GET",
            "url.path": "/users/42",
            "url.scheme": "http",
            "server.address": "example.com",
            "user_agent.original": "test-agent",
            "http.route": "/users/:id",
            "http.response.status_code": 200,
        });
        expect(span!.status.code).toBe(api.SpanStatusCode.UNSET);
    });

    test("ルートがなければ、名前はメソッドだけで http.route なし。404 はエラーにしない", async () => {
        const app = makeApp();
        await app.fetch(req("/missing"));
        const [span] = spans();
        expect(span!.name).toBe("GET");
        expect(span!.attributes["http.route"]).toBeUndefined();
        expect(span!.attributes["http.response.status_code"]).toBe(404);
        expect(span!.status.code).toBe(api.SpanStatusCode.UNSET);
    });

    test("受け取った traceparent のトレースを続ける", async () => {
        const app = makeApp();
        app.get("/", () => "ok");
        const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
        const parentId = "00f067aa0ba902b7";
        await app.fetch(req("/", { headers: { traceparent: `00-${traceId}-${parentId}-01` } }));
        const [span] = spans();
        expect(span!.spanContext().traceId).toBe(traceId);
        expect(parentOf(span!)).toBe(parentId);
    });

    test("ハンドラーで作った span は、server span の子になる(await のあとも)", async () => {
        const app = makeApp();
        app.get("/", async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            tracer.startActiveSpan("db.query", (span) => span.end());
            return "ok";
        });
        await app.fetch(req("/"));
        expect(parentOf(byName("db.query"))).toBe(byName("GET /").spanContext().spanId);
    });

    test("例外は 500 でエラーにし、exception を記録する", async () => {
        const app = makeApp();
        app.get("/boom", () => {
            throw new Error("boom");
        });
        await app.fetch(req("/boom"));
        const span = byName("GET /boom");
        expect(span.status.code).toBe(api.SpanStatusCode.ERROR);
        expect(span.attributes["http.response.status_code"]).toBe(500);
        expect(span.events.map((e) => [e.name, e.attributes?.["exception.message"]])).toEqual([["exception", "boom"]]);
    });

    test("middlewareSpans なしでは、server span だけ", async () => {
        const app = makeApp();
        app.use(async (_, next) => next());
        app.get("/", () => "ok");
        await app.fetch(req("/"));
        expect(spans().map((s) => s.name)).toEqual(["GET /"]);
    });

    test("middlewareSpans: ミドルウェアとハンドラーの子 span が、玉ねぎのとおりに入れ子になる", async () => {
        const app = makeApp({ middlewareSpans: true });
        app.use(async function auth(_, next) {
            return next();
        });
        app.use(async function timing(_, next) {
            return next();
        });
        app.get("/users/:id", () => "ok");
        await app.fetch(req("/users/1"));
        const server = byName("GET /users/:id");
        const auth = byName("middleware auth");
        const timing = byName("middleware timing");
        const handler = byName("handler GET /users/:id");
        expect(parentOf(auth)).toBe(server.spanContext().spanId);
        expect(parentOf(timing)).toBe(auth.spanContext().spanId);
        expect(parentOf(handler)).toBe(timing.spanContext().spanId);
        expect(auth.kind).toBe(api.SpanKind.INTERNAL);
        expect(auth.attributes["senri.middleware"]).toBe("auth");
        // 外側の span は、内側が終わってから終わる(SimpleSpanProcessor は end() の順に書き出す。時刻は丸めで前後しうるので使わない)
        expect(spans().map((s) => s.name)).toEqual(["handler GET /users/:id", "middleware timing", "middleware auth", "GET /users/:id"]);
    });

    test("middlewareSpans: next() を呼ばずに返した層より内側は、span がない。投げた層はエラー", async () => {
        const app = makeApp({ middlewareSpans: true });
        app.use(async function guard(c, next) {
            if (c.req.headers.get("authorization") === null) return c.text("401 Unauthorized", 401);
            return next();
        });
        app.get("/", () => {
            throw new Error("handler failed");
        });
        await app.fetch(req("/"));
        expect(spans().map((s) => s.name).sort()).toEqual(["GET /", "middleware guard"]);
        exporter.reset();

        await app.fetch(req("/", { headers: { authorization: "x" } }));
        const handler = byName("handler GET /");
        expect(handler.status.code).toBe(api.SpanStatusCode.ERROR);
        expect(handler.events[0]?.attributes?.["exception.message"]).toBe("handler failed");
        expect(byName("middleware guard").status.code).toBe(api.SpanStatusCode.UNSET);
    });

    test("otel() より前のミドルウェアは、子 span にならない", async () => {
        const app = createApp();
        app.use(async function before(_, next) {
            return next();
        });
        app.use(otel({ api, tracer, middlewareSpans: true }));
        app.get("/", () => "ok");
        await app.fetch(req("/"));
        expect(spans().map((s) => s.name).sort()).toEqual(["GET /", "handler GET /"]);
    });

    test("同時に処理しているリクエストの span が混ざらない", async () => {
        const app = makeApp({ middlewareSpans: true });
        app.get("/:name", async ({ name }) => {
            await new Promise((resolve) => setTimeout(resolve, name === "a" ? 5 : 1));
            return name;
        });
        await Promise.all([app.fetch(req("/a")), app.fetch(req("/b"))]);
        const servers = spans().filter((s) => s.name === "GET /:name");
        const handlers = spans().filter((s) => s.name === "handler GET /:name");
        expect(servers).toHaveLength(2);
        expect(handlers.map((h) => parentOf(h)).sort()).toEqual(servers.map((s) => s.spanContext().spanId).sort());
        expect(new Set(handlers.map((h) => h.spanContext().traceId))).toEqual(new Set(servers.map((s) => s.spanContext().traceId)));
    });

    test("開発モードでも同じ", async () => {
        const app = makeApp({ middlewareSpans: true }, true);
        app.get("/", () => "ok");
        await app.fetch(new Request("http://localhost/"));
        expect(spans().map((s) => s.name).sort()).toEqual(["GET /", "handler GET /"]);
    });

    test("tracer を省くと api.trace.getTracer(\"@senrijs/senri\")", async () => {
        api.trace.setGlobalTracerProvider(provider);
        try {
            const app = createApp();
            app.use(otel({ api }));
            app.get("/", () => "ok");
            await app.fetch(req("/"));
            expect(spans()[0]!.instrumentationScope.name).toBe("@senrijs/senri");
        } finally {
            api.trace.disable();
        }
    });

    test("Node の近道で使える(markPlainSafe)", () => {
        expect(isPlainSafe(otel({ api, tracer }))).toBe(true);
    });
});
