// contextStorage() を Node のアダプターで確かめる
// Request も Response も作らない近道でも getContext() が使え、app.fetch を通す道と同じ応答になるか
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { contextStorage, getContext } from "../../adapters/context-storage/index.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function makeApp() {
    const app = createApp();
    app.use(contextStorage());
    app.get("/items/:id", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getContext().path;
    });
    return app;
}

describe("contextStorage() と Node の近道", () => {
    test("どちらの道でも、await のあとに getContext() が使える", async () => {
        const ports = await bothPaths(makeApp());
        const text = request("GET", "/items/7");
        const lazy = await raw(ports.lazy, text);
        assert.equal(lazy, await raw(ports.viaFetch, text));
        assert.match(lazy, /^HTTP\/1\.1 200 [\s\S]*\/items\/7$/);
    });

    test("Request も Response も作らない(c.req を読まなければ)", async () => {
        const port = await listen(makeApp());
        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/items/1")), /\/items\/1$/);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });
});
