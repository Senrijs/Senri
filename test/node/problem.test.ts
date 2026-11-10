// problemDetails() を Node のアダプターで確かめる
// Node の近道(既定の 404 を Response なしで返すなど)を通っても、app.fetch を通す道と同じ応答になるか
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { problemDetails, ProblemError } from "../../src/problem.ts";
import { bothPaths, closeServers, raw, request } from "./http.ts";

after(closeServers);

describe("problemDetails() と Node のアダプター", () => {
    test("404・405・ProblemError・HEAD が、どちらの道でも同じ", async () => {
        const app = createApp();
        const problems = problemDetails();
        app.onError(problems.onError);
        app.notFound(problems.notFound);
        app.get("/items", () => "items");
        app.get("/denied", () => {
            throw new ProblemError(403, { detail: "No access." });
        });
        const ports = await bothPaths(app);

        for (const [method, path] of [
            ["GET", "/nope"],
            ["HEAD", "/nope"],
            ["DELETE", "/items"],
            ["GET", "/denied"],
        ] as const) {
            const lazy = await raw(ports.lazy, request(method, path));
            const viaFetch = await raw(ports.viaFetch, request(method, path));
            assert.equal(lazy, viaFetch, `${method} ${path}`);
            assert.match(lazy, /^content-type: application\/problem\+json$/im, `${method} ${path}`);
        }
        const notFound = await raw(ports.lazy, request("GET", "/nope"));
        assert.match(notFound, /^HTTP\/1\.1 404 /);
        assert.ok(notFound.endsWith(`{"type":"about:blank","title":"Not Found","status":404}`), notFound);
        // HEAD には本文を付けない
        assert.ok((await raw(ports.lazy, request("HEAD", "/nope"))).endsWith("\r\n\r\n"));
    });
});
