// selfHeal() を Node のアダプターで確かめる
// Request も Response も作らない近道でも、同じように止めて 503 + Retry-After を返すか
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { selfHeal } from "../../src/self-heal.ts";
import { closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function makeApp() {
    const app = createApp();
    app.use(selfHeal({ minRequests: 3, log: () => {} }));
    app.get("/down", (_, c) => c.text("down", 500));
    app.get("/up", () => "up");
    return app;
}

const statusOf = (text: string) => Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]);

describe("selfHeal() と Node の近道", () => {
    test("どちらの道でも、失敗が続いたルートだけを止めて 503 + Retry-After を返す", async () => {
        // 道ごとに別のアプリにする(同じアプリだと、2 つめの道では最初から止まっている)
        const viaFetch = makeApp();
        const ports = [await listen(makeApp()), await listen({ fetch: (req, info) => viaFetch.fetch(req, info) })];
        for (const port of ports) {
            for (let i = 0; i < 3; i++) assert.equal(statusOf(await raw(port, request("GET", "/down"))), 500);
            const paused = await raw(port, request("GET", "/down"));
            assert.equal(statusOf(paused), 503);
            assert.match(paused, /^retry-after: \d+\r$/m);
            assert.equal(statusOf(await raw(port, request("GET", "/up"))), 200);
        }
    });

    test("止めていないときは、Request も Response も作らない", async () => {
        const port = await listen(makeApp());
        const created = await counting(async () => {
            assert.match(await raw(port, request("GET", "/up")), /up$/);
        });
        assert.deepEqual(created, { Request: 0, Response: 0 });
    });
});
