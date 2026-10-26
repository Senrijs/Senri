import { describe, expect, test } from "bun:test";
import { canOpenDashboard, isLocalHost, isLoopback, remoteAddress, sameOrigin } from "../../src/dev/dashboard/access.ts";
import { createApp } from "../../src/index.ts";

const req = (url = "http://localhost:3927/_senri", headers: Record<string, string> = {}) =>
    new Request(url, { headers: { host: new URL(url).host, ...headers } });

// 3ランタイムが app.fetch の2つ目の引数に渡すもの(の、ここで使う部分)
const bunServer = (address: string | null) => ({ requestIP: () => (address ? { address, family: "IPv4", port: 1 } : null) });
const denoInfo = (hostname: string) => ({ remoteAddr: { transport: "tcp", hostname, port: 1 } });
// Cloudflare Workers は fetch(req, env, ctx)。env は利用者が決めたバインディングの入れ物
const cloudflareEnv = { MY_KV: {}, API_URL: "https://example.com" };

describe("remoteAddress: 2つ目の引数を形で見分ける", () => {
    test("Bun の server(requestIP がある)", () => {
        expect(remoteAddress(req(), bunServer("127.0.0.1"))).toBe("127.0.0.1");
        expect(remoteAddress(req(), bunServer(null))).toBeNull();
    });

    test("Deno の info(remoteAddr.hostname がある)。Node のアダプターも同じ形で渡す", () => {
        expect(remoteAddress(req(), denoInfo("::1"))).toBe("::1");
    });

    test("それ以外(Cloudflare の env、なし、文字列、例外を投げる値)は接続元不明", () => {
        const throwing = new Proxy(
            {},
            {
                get() {
                    throw new Error("触らないで");
                },
            },
        );
        for (const info of [cloudflareEnv, undefined, null, "x", 42, throwing, { remoteAddr: "127.0.0.1" }]) {
            expect(remoteAddress(req(), info)).toBeNull();
        }
    });
});

describe("isLoopback", () => {
    test("ループバックのアドレス", () => {
        for (const a of ["127.0.0.1", "127.1.2.3", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"]) {
            expect(isLoopback(a)).toBe(true);
        }
    });

    test("それ以外(LAN、Docker のブリッジ、不明)", () => {
        for (const a of ["192.168.1.10", "172.17.0.1", "10.0.0.2", "::ffff:192.168.1.10", "128.0.0.1", "", null]) {
            expect(isLoopback(a)).toBe(false);
        }
    });
});

describe("isLocalHost: Host ヘッダー(DNS リバインディング対策)", () => {
    test("localhost 系の名前だけ", () => {
        for (const h of ["localhost", "localhost:3927", "127.0.0.1:3927", "[::1]:3927", "app.localhost:3927"]) {
            expect(isLocalHost(h)).toBe(true);
        }
        for (const h of ["evil.example", "evil.example:3927", "localhost.evil.example", "192.168.1.10:3927", "", null]) {
            expect(isLocalHost(h)).toBe(false);
        }
    });
});

describe("canOpenDashboard", () => {
    test("接続元がループバックで、Host も localhost のときだけ", () => {
        expect(canOpenDashboard(req(), bunServer("127.0.0.1"))).toBe(true);
        expect(canOpenDashboard(req(), denoInfo("::1"))).toBe(true);
    });

    test("接続元が外、Host が偽物、接続元不明はだめ", () => {
        expect(canOpenDashboard(req(), bunServer("192.168.1.10"))).toBe(false);
        expect(canOpenDashboard(req("http://evil.example:3927/_senri"), bunServer("127.0.0.1"))).toBe(false);
        expect(canOpenDashboard(req(), cloudflareEnv)).toBe(false);
        expect(canOpenDashboard(req(), undefined)).toBe(false);
    });
});

describe("sameOrigin: 状態を変える POST の保護", () => {
    test("Origin がページと同じときだけ", () => {
        expect(sameOrigin(req(undefined, { origin: "http://localhost:3927" }))).toBe(true);
        expect(sameOrigin(req(undefined, { origin: "http://evil.example" }))).toBe(false);
        expect(sameOrigin(req())).toBe(false);
    });
});

describe("app.fetch の2つ目以降の引数", () => {
    test("何が来ても、普通のリクエストはそのまま動く(Cloudflare の env, ctx も)", async () => {
        const app = createApp({ dev: true });
        app.get("/hello", () => "hi");
        const ctx = { waitUntil() {}, passThroughOnException() {} };

        for (const args of [[cloudflareEnv, ctx], [bunServer("127.0.0.1")], [denoInfo("::1")], ["x"], []] as unknown[][]) {
            const res = await (app.fetch as (...a: unknown[]) => Promise<Response>)(req("http://localhost/hello"), ...args);
            expect(await res.text()).toBe("hi");
        }
    });
});
