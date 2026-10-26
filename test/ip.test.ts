import { describe, expect, test } from "bun:test";
import { bodyLimit, createApp } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

function ipApp() {
    const app = createApp();
    app.get("/ip", (_, c) => c.ip ?? "unknown");
    return app;
}

describe("c.ip", () => {
    test("Bun の server(requestIP)から取る", async () => {
        const server = { requestIP: () => ({ address: "203.0.113.5", family: "IPv4", port: 1 }) };
        expect(await (await ipApp().fetch(req("/ip"), server)).text()).toBe("203.0.113.5");
    });

    test("Deno の info(remoteAddr)から取る。Node アダプターも同じ形", async () => {
        const info = { remoteAddr: { hostname: "2001:db8::1", port: 1, transport: "tcp" } };
        expect(await (await ipApp().fetch(req("/ip"), info)).text()).toBe("2001:db8::1");
    });

    test("IPv4 を IPv6 の形で書いたもの(::ffff:)は IPv4 にする", async () => {
        const info = { remoteAddr: { hostname: "::ffff:192.0.2.1" } };
        expect(await (await ipApp().fetch(req("/ip"), info)).text()).toBe("192.0.2.1");
    });

    test("分からなければ null(引数なし、Workers の env など)", async () => {
        const app = ipApp();
        expect(await (await app.fetch(req("/ip"))).text()).toBe("unknown");
        expect(await (await app.fetch(req("/ip"), { DB: {}, API_KEY: "x" })).text()).toBe("unknown");
    });

    test("X-Forwarded-For は読まない(偽装できるため)", async () => {
        const info = { remoteAddr: { hostname: "10.0.0.1" } };
        const res = await ipApp().fetch(req("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } }), info);
        expect(await res.text()).toBe("10.0.0.1");
    });

    test("ミドルウェアが c.req を差し替えても、元のリクエストで聞く", async () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 100 }));
        app.post("/ip", (_, c) => c.ip ?? "unknown");
        const original = req("/ip", { method: "POST", body: "x" });
        const server = { requestIP: (r: Request) => (r === original ? { address: "198.51.100.7" } : null) };

        expect(await (await app.fetch(original, server)).text()).toBe("198.51.100.7");
    });
});
