// requestId() は Node でも Request / Response を作らない。応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cors, createApp, requestId, secureHeaders, type RequestIdVariables } from "../../src/index.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

function appWith(options: Parameters<typeof requestId>[0]) {
    const app = createApp<RequestIdVariables>();
    app.use(requestId(options));
    app.get("/", (_, c) => c.get("requestId") ?? "none");
    return app;
}

describe("requestId() と Node の近道", () => {
    test("Request も Response も作らない", async () => {
        const app = createApp();
        app.use(requestId({ trustIncoming: true }));
        app.use(secureHeaders());
        app.use(cors());
        app.get("/", () => "Hello");
        const port = await listen(app);

        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/", { "X-Request-Id": "abc" })), /^x-request-id: abc$/im);
        });

        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("2つの道の応答が同じ", async () => {
        const { lazy, viaFetch } = await bothPaths(appWith({ trustIncoming: true, generator: () => "generated" }));
        const requests = [
            request("GET", "/"),
            request("HEAD", "/"),
            request("GET", "/none"),
            request("GET", "/", { "X-Request-Id": "abc-123" }),
            request("GET", "/", { "X-REQUEST-ID": "abc-123" }),
            request("GET", "/", { "X-Request-Id": "bad value" }),
            request("GET", "/", { "X-Request-Id": "a\tb" }),
            request("GET", "/", { "X-Request-Id": "\xe6\x97\xa5" }),
            request("GET", "/", { "X-Request-Id": "A".repeat(129) }),
            // 同じヘッダーが2つあると、カンマでつながって安全でない値になる
            `GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nX-Request-Id: a\r\nX-Request-Id: b\r\n\r\n`,
        ];
        for (const text of requests) assert.equal(await raw(lazy, text), await raw(viaFetch, text), text);
    });

    test("安全でない値は捨てて、本文にも入らない", async () => {
        const port = await listen(appWith({ trustIncoming: true, generator: () => "generated" }));
        const text = await raw(port, request("GET", "/", { "X-Request-Id": "evil value" }));

        assert.match(text, /^x-request-id: generated$/im);
        assert.ok(!text.includes("evil"));
    });
});
