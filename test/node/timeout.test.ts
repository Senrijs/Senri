// timeout() は Node でも Request / Response を作らない。応答は app.fetch を通す道と同じ
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp, secureHeaders, timeout } from "../../src/index.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = console.error;

before(() => {
    console.error = () => {};
});
after(() => {
    console.error = quiet;
    closeServers();
});

function makeApp() {
    const app = createApp();
    app.use(timeout(20));
    app.use(secureHeaders());
    app.get("/fast", () => "fast");
    app.get("/json", () => ({ a: 1 }));
    app.get("/slow", () => sleep(200).then(() => "late"));
    app.get("/slow-json", () => sleep(200).then(() => ({ a: 1 })));
    app.get("/slow-throw", async () => {
        await sleep(200);
        throw new Error("late");
    });
    app.get("/slow-response", () => sleep(200).then(() => new Response("late")));
    return app;
}

describe("timeout() と Node の近道", () => {
    test("時間内なら Request も Response も作らない", async () => {
        const port = await listen(makeApp());

        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/fast")), /^HTTP\/1\.1 200/);
        });

        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("2つの道の応答が同じ", async () => {
        const { lazy, viaFetch } = await bothPaths(makeApp());
        for (const path of ["/fast", "/json", "/slow", "/slow-json", "/slow-throw", "/slow-response", "/none"]) {
            for (const method of ["GET", "HEAD"]) {
                const text = request(method, path);
                assert.equal(await raw(lazy, text), await raw(viaFetch, text), `${method} ${path}`);
            }
        }
    });

    test("時間切れなら 504 を返す。あとから終わっても壊れない", async () => {
        const port = await listen(makeApp());
        for (const path of ["/slow", "/slow-json", "/slow-throw", "/slow-response"]) {
            assert.match(await raw(port, request("GET", path)), /^HTTP\/1\.1 504/, path);
        }
        await sleep(300);
        assert.match(await raw(port, request("GET", "/fast")), /^HTTP\/1\.1 200/);
    });
});
