// ipRestriction() は Node でも、通すリクエストでは Request / Response を作らない。応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp, ipRestriction, secureHeaders } from "../../src/index.ts";
import { trustProxy } from "../../src/ip.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function appWith(options: Parameters<typeof ipRestriction>[0]) {
    const app = createApp();
    app.use(ipRestriction(options));
    app.use(secureHeaders());
    app.get("/", () => "ok");
    return app;
}

describe("ipRestriction() と Node", () => {
    test("通すリクエストでは Request も Response も作らない", async () => {
        const port = await listen(appWith({ allow: ["127.0.0.0/8"] }));

        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/")), /^HTTP\/1\.1 200/);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("本物の接続元で比べる", async () => {
        assert.match(await raw(await listen(appWith({ allow: ["127.0.0.0/8"] })), request("GET", "/")), /^HTTP\/1\.1 200/);
        assert.match(await raw(await listen(appWith({ deny: ["127.0.0.1"] })), request("GET", "/")), /^HTTP\/1\.1 403/);
    });

    test("2つの道の応答が同じ", async () => {
        const ip = trustProxy({ hops: 1 });
        const list: [Parameters<typeof ipRestriction>[0], Record<string, string>][] = [
            [{ allow: ["127.0.0.0/8"] }, {}],
            [{ allow: ["10.0.0.0/8"] }, {}],
            [{ deny: ["127.0.0.1"] }, {}],
            [{ deny: ["10.0.0.1"] }, {}],
            [{ allow: ["1.1.1.1"], ip }, { "X-Forwarded-For": "6.6.6.6, 1.1.1.1" }],
            [{ allow: ["1.1.1.1"], ip }, { "X-Forwarded-For": "1.1.1.1, 6.6.6.6" }],
            [{ allow: ["0.0.0.0/0"], ip }, { "X-Forwarded-For": "evil" }],
        ];
        for (const [options, headers] of list) {
            const { lazy, viaFetch } = await bothPaths(appWith(options));
            for (const method of ["GET", "HEAD", "POST"]) {
                const text = request(method, "/", headers);
                assert.equal(await raw(lazy, text), await raw(viaFetch, text), `${method} ${JSON.stringify(headers)}`);
            }
        }
    });
});
