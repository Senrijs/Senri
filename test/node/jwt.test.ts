// jwt() を Node のアダプターで確かめる
// Request を作らない近道でも、app.fetch を通す道と同じ応答になるか
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/index.ts";
import { jwt, signJwt, type JwtVariables } from "../../src/jwt.ts";
import { bothPaths, closeServers, counting, listen, raw, request } from "./http.ts";

after(closeServers);

const SECRET = "a-secret-that-is-at-least-32-bytes-long!!";

function makeApp() {
    const app = createApp<JwtVariables>();
    app.use("/api", jwt({ keys: SECRET, algorithms: ["HS256"], realm: "api" }));
    app.get("/api/me", (_, c) => `user ${c.get("jwtPayload")?.sub}`);
    return app;
}

describe("jwt() と Node の近道", () => {
    test("通すときも拒否するときも、どちらの道でも同じ", async () => {
        const ports = await bothPaths(makeApp());
        const good = await signJwt({ sub: "42" }, SECRET, { alg: "HS256" });
        const expired = await signJwt({ sub: "42", exp: 1 }, SECRET, { alg: "HS256" });
        const cases: [Record<string, string>, RegExp][] = [
            [{ Authorization: `Bearer ${good}` }, /^HTTP\/1\.1 200 [\s\S]*user 42$/],
            [{}, /^HTTP\/1\.1 401 [\s\S]*^www-authenticate: Bearer realm="api"\r$/m],
            [{ Authorization: `Bearer ${expired}` }, /^HTTP\/1\.1 401 [\s\S]*error="invalid_token"[\s\S]*token expired$/],
        ];
        for (const [headers, expected] of cases) {
            const text = request("GET", "/api/me", headers);
            const lazy = await raw(ports.lazy, text);
            assert.equal(lazy, await raw(ports.viaFetch, text), JSON.stringify(headers));
            assert.match(lazy, expected, JSON.stringify(headers));
        }
    });

    test("Request も Response も作らない", async () => {
        const port = await listen(makeApp());
        const token = await signJwt({ sub: "1" }, SECRET, { alg: "HS256" });
        const counts = await counting(async () => {
            assert.match(await raw(port, request("GET", "/api/me", { Authorization: `Bearer ${token}` })), /user 1$/);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });
});
