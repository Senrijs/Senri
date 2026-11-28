// chaos() を Node のアダプターで確かめる
// Request も Response も作らない近道でも、ヘッダーを読んで同じように壊すか
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { chaos } from "../../src/chaos.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function makeApp() {
    const app = createApp();
    app.use(chaos({ enabled: true, log: () => {} }));
    app.get("/users/:id", ({ id }) => `user ${id}`);
    return app;
}

const statusOf = (text: string) => Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]);

describe("chaos() と Node の近道", () => {
    test("どちらの道でも、X-Senri-Chaos ヘッダーのとおりに壊す", async () => {
        const ports = await bothPaths(makeApp());
        for (const port of [ports.lazy, ports.viaFetch]) {
            assert.equal(statusOf(await raw(port, request("GET", "/users/1", { "x-senri-chaos": "status=503" }))), 503);
            assert.equal(statusOf(await raw(port, request("GET", "/users/1", { "x-senri-chaos": "latency=5" }))), 200);
            assert.equal(statusOf(await raw(port, request("GET", "/users/1", { "x-senri-chaos": "nope" }))), 400);
            assert.equal(statusOf(await raw(port, request("GET", "/users/1"))), 200);
        }
    });

    test("壊さないリクエストでは、Request も Response も作らない", async () => {
        const port = await listen(makeApp());
        const created = await counting(async () => {
            assert.match(await raw(port, request("GET", "/users/3")), /user 3$/);
        });
        assert.deepEqual(created, { Request: 0, Response: 0 });
    });
});
