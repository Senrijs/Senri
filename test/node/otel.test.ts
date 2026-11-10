// otel() を Node のアダプターで確かめる
// Request も Response も作らない近道でも、span の名前・属性・status が app.fetch の道と同じか
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as api from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createApp } from "../../src/index.ts";
import { otel } from "../../src/otel.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

const exporter = new InMemorySpanExporter();
const tracer = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).getTracer("test");

before(() => {
    api.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    api.propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});
after(closeServers);
afterEach(() => exporter.reset());

function makeApp() {
    const app = createApp();
    app.use(otel({ api, tracer, middlewareSpans: true }));
    app.get("/users/:id", ({ id }) => `user ${id}`);
    return app;
}

const summary = () =>
    exporter
        .getFinishedSpans()
        .map((s) => `${s.name} ${s.attributes["http.response.status_code"] ?? "-"} ${s.parentSpanContext?.spanId ?? "root"}`)
        .map((line) => line.replace(/[0-9a-f]{16}$/, "child"));

describe("otel() と Node の近道", () => {
    test("どちらの道でも、同じ span になる(traceparent も引き継ぐ)", async () => {
        const ports = await bothPaths(makeApp());
        const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        const results: string[][] = [];
        for (const port of [ports.lazy, ports.viaFetch]) {
            await raw(port, request("GET", "/users/1", { traceparent }));
            await raw(port, request("GET", "/missing"));
            results.push(summary());
            assert.ok(exporter.getFinishedSpans().every((s) => s.spanContext().traceId === "4bf92f3577b34da6a3ce929d0e0e4736" || !s.name.includes("users")));
            exporter.reset();
        }
        assert.deepEqual(results[0], results[1]);
        // ルートがないときも、いちばん内側(404 を返すところ)が handler の span になる
        assert.deepEqual(results[0], ["handler GET /users/:id - child", "GET /users/:id 200 child", "handler GET - child", "GET 404 root"]);
    });

    test("Request も Response も作らない", async () => {
        const port = await listen(makeApp());
        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/users/2")), /user 2$/);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });
});
