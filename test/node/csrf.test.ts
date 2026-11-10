// csrf() を Node のアダプターで確かめる
// Request も Response も作らない近道でも、app.fetch を通す道と同じ判定になるか
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp, csrf } from "../../src/index.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function makeApp() {
    const app = createApp();
    app.use(csrf({ origin: ["https://admin.example.com"] }));
    app.get("/form", () => "form");
    app.post("/form", () => "posted");
    return app;
}

describe("csrf() と Node の近道", () => {
    test("通すときも拒否するときも、どちらの道でも同じ", async () => {
        const ports = await bothPaths(makeApp());
        const cases: [string, Record<string, string>, number][] = [
            ["GET", { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" }, 200],
            ["POST", {}, 200],
            ["POST", { "Sec-Fetch-Site": "same-origin" }, 200],
            ["POST", { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" }, 403],
            ["POST", { "Sec-Fetch-Site": "cross-site", Origin: "https://admin.example.com" }, 200],
            // Sec-Fetch-Site がないとき、Origin を Host(request() は localhost)と比べる
            ["POST", { Origin: "http://localhost" }, 200],
            ["POST", { Origin: "https://evil.example" }, 403],
        ];
        for (const [method, headers, status] of cases) {
            const text = request(method, "/form", { ...headers, "Content-Length": "0" });
            const lazy = await raw(ports.lazy, text);
            assert.equal(lazy, await raw(ports.viaFetch, text), `${method} ${JSON.stringify(headers)}`);
            assert.match(lazy, new RegExp(`^HTTP/1\\.1 ${status} `), `${method} ${JSON.stringify(headers)}`);
        }
    });

    test("Request も Response も作らない", async () => {
        const port = await listen(makeApp());
        const counts = await counting(async () => {
            assert.match(await raw(port, request("POST", "/form", { Origin: "http://localhost", "Content-Length": "0" })), /^HTTP\/1\.1 200 /);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });
});
