// trustProxy() は Node でも Request を作らずに読める。応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { getIp, trustProxy, type TrustProxyOptions } from "../../src/ip.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function appWith(options: TrustProxyOptions) {
    const clientIp = trustProxy(options);
    const app = createApp();
    app.get("/", (_, c) => clientIp(c) ?? "null");
    return app;
}

const bodyOf = (text: string) => text.slice(text.indexOf("\r\n\r\n") + 4);

describe("trustProxy() と Node", () => {
    test("Request も Response も作らない", async () => {
        const port = await listen(appWith({ hops: 1 }));

        const counts = await counting(async () => {
            assert.equal(bodyOf(await raw(port, request("GET", "/", { "X-Forwarded-For": "6.6.6.6, 1.1.1.1" }))), "1.1.1.1");
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("本物の接続元で proxies を比べる", async () => {
        const trusted = await listen(appWith({ proxies: ["127.0.0.0/8", "::1"] }));
        const other = await listen(appWith({ proxies: ["10.0.0.0/8"] }));
        const headers = { "X-Forwarded-For": "1.1.1.1" };

        assert.equal(bodyOf(await raw(trusted, request("GET", "/", headers))), "1.1.1.1");
        assert.equal(bodyOf(await raw(other, request("GET", "/", headers))), "127.0.0.1");
    });

    test("2つの道の応答が同じ", async () => {
        const list: [TrustProxyOptions, Record<string, string>][] = [
            [{ hops: 1 }, {}],
            [{ hops: 1 }, { "X-Forwarded-For": "1.1.1.1" }],
            [{ hops: 2 }, { "X-Forwarded-For": "6.6.6.6, 1.1.1.1, 2.2.2.2" }],
            [{ hops: 1 }, { "X-Forwarded-For": "evil" }],
            [{ proxies: ["127.0.0.0/8"] }, { "X-Forwarded-For": "1.1.1.1, 127.0.0.2" }],
            [{ hops: 1, header: "Forwarded" }, { Forwarded: 'for="[2001:db8::1]:80"' }],
            [{ hops: 1, header: "CF-Connecting-IP" }, { "CF-Connecting-IP": "1.1.1.1" }],
        ];
        for (const [options, headers] of list) {
            const { lazy, viaFetch } = await bothPaths(appWith(options));
            const text = request("GET", "/", headers);
            assert.equal(await raw(lazy, text), await raw(viaFetch, text), JSON.stringify([options, headers]));
        }
    });

    test("同じヘッダーが2行あれば、2つの道とも右から数える", async () => {
        const { lazy, viaFetch } = await bothPaths(appWith({ hops: 1 }));
        const text = "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nX-Forwarded-For: 6.6.6.6\r\nX-Forwarded-For: 1.1.1.1\r\n\r\n";

        assert.equal(bodyOf(await raw(lazy, text)), "1.1.1.1");
        assert.equal(await raw(lazy, text), await raw(viaFetch, text));
    });

    test("getIp() はヘッダーを読まない", async () => {
        const app = createApp();
        app.get("/", (_, c) => getIp(c) ?? "null");
        const port = await listen(app);

        assert.equal(bodyOf(await raw(port, request("GET", "/", { "X-Forwarded-For": "6.6.6.6" }))), "127.0.0.1");
    });
});
