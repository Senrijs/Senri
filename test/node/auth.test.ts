// basicAuth() / bearerAuth() は Node でも Request / Response を作らない。応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { basicAuth, bearerAuth, createApp, secureHeaders } from "../../src/index.ts";
import { bothPaths, closeServers, COMPARE_TIMEOUT, compareBothPaths, counting, listen, raw, rawCases, request } from "./http.ts";

after(closeServers);

const basic = (text: string) => `Basic ${Buffer.from(text).toString("base64")}`;

function makeApp() {
    const app = createApp();
    app.use("/basic", basicAuth({ username: "admin", password: "pw" }));
    app.use("/bearer", bearerAuth({ token: ["one", "two"] }));
    app.use("/verify-basic", basicAuth({ verifyUser: async (user, password) => user === "a" && password === "b" }));
    app.use("/verify-bearer", bearerAuth({ verifyToken: (token) => token === "abc" }));
    for (const path of ["/basic", "/bearer", "/verify-basic", "/verify-bearer"]) app.get(path, () => ({ path }));
    return app;
}

describe("basicAuth() / bearerAuth() と Node の近道", () => {
    test("Request も Response も作らない", async () => {
        const app = makeApp();
        app.use(secureHeaders());
        const port = await listen(app);
        const cases: [string, string][] = [
            ["/basic", basic("admin:pw")],
            ["/bearer", "Bearer two"],
            ["/verify-basic", basic("a:b")],
            ["/verify-bearer", "Bearer abc"],
        ];
        for (const [path, authorization] of cases) {
            const counts = await counting(async () => {
                assert.match(await raw(port, request("GET", path, { Authorization: authorization })), /^HTTP\/1\.1 200/, path);
            });
            assert.deepEqual(counts, { Request: 0, Response: 0 }, path);
        }
    });

    test("2つの道の応答が同じ", { timeout: COMPARE_TIMEOUT }, async (t) => {
        const headers: Record<string, string>[] = [
            {},
            { Authorization: "" },
            { Authorization: basic("admin:pw") },
            { Authorization: basic("admin:wrong") },
            { Authorization: basic("a:b") },
            { Authorization: "basic !!!" },
            { Authorization: "Bearer one" },
            { Authorization: "bearer two" },
            { Authorization: "Bearer three" },
            { Authorization: "Bearer abc" },
            { Authorization: "Bearer a b" },
            { Authorization: "Bearer \xe6\x97\xa5" },
        ];
        const texts = ["/basic", "/bearer", "/verify-basic", "/verify-bearer"].flatMap((path) =>
            ["GET", "HEAD", "POST"].flatMap((method) => headers.map((header) => request(method, path, header))),
        );
        await compareBothPaths(await bothPaths(makeApp()), rawCases(texts.map((text) => [text, text])), t.signal);
    });

    test("Authorization が2つあっても、2つの道の応答が同じ", async () => {
        const { lazy, viaFetch } = await bothPaths(makeApp());
        const text = `GET /bearer HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAuthorization: Bearer one\r\nAuthorization: Bearer wrong\r\n\r\n`;

        assert.equal(await raw(lazy, text), await raw(viaFetch, text));
    });

    test("検証する関数に渡す c は、本物の c.req を読める", async () => {
        let proto: unknown;
        const app = createApp();
        app.use(
            bearerAuth({
                verifyToken: (_token, c) => {
                    proto = Object.getPrototypeOf(c.req);
                    return true;
                },
            }),
        );
        app.get("/", () => "ok");
        await raw(await listen(app), request("GET", "/", { Authorization: "Bearer a" }));

        assert.equal(proto, Request.prototype);
    });
});
