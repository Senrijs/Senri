// metrics() を Node のアダプターで確かめる
// Request も Response も作らない近道でも、app.fetch を通す道と同じように数えるか
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { metrics, metricsHandler, resetMetrics } from "../../src/metrics.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);
beforeEach(resetMetrics);

function makeApp() {
    const app = createApp();
    app.use(metrics());
    app.get("/users/:id", ({ id }) => `user ${id}`);
    app.get("/metrics", metricsHandler());
    return app;
}

// 件数の行だけ(時間は毎回違うので比べない)
const counts = (text: string) => text.split("\n").filter((line) => line.startsWith("http_server_request_duration_seconds_count"));

describe("metrics() と Node の近道", () => {
    test("どちらの道でも、同じように数える", async () => {
        const ports = await bothPaths(makeApp());
        const results: string[][] = [];
        for (const port of [ports.lazy, ports.viaFetch]) {
            resetMetrics();
            await raw(port, request("GET", "/users/1"));
            await raw(port, request("GET", "/users/2"));
            await raw(port, request("GET", "/missing"));
            const scraped = await raw(port, request("GET", "/metrics"));
            assert.match(scraped, /^content-type: text\/plain; version=0\.0\.4; charset=utf-8\r$/m);
            results.push(counts(scraped.slice(scraped.indexOf("\r\n\r\n") + 4)));
        }
        assert.deepEqual(results[0], results[1]);
        assert.deepEqual(results[0], [
            'http_server_request_duration_seconds_count{method="GET",route="/users/:id",status="200"} 2',
            'http_server_request_duration_seconds_count{method="GET",route="unmatched",status="404"} 1',
        ]);
    });

    test("Request も Response も作らない(数えるだけのとき)", async () => {
        const port = await listen(makeApp());
        const created = await counting(async () => {
            assert.match(await raw(port, request("GET", "/users/3")), /user 3$/);
        });
        assert.deepEqual(created, { Request: 0, Response: 0 });
    });
});
