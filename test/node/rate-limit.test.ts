// rateLimit() は Node でも、通すリクエストでは Request / Response を作らない。応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp, rateLimit, secureHeaders } from "../../src/index.ts";
import { trustProxy } from "../../src/ip.ts";
import { closeServers, counting, listen, raw, request } from "./http.ts";
import { serve } from "../../adapters/node/index.ts";

after(closeServers);

function appWith(options: Parameters<typeof rateLimit>[0]) {
    const app = createApp();
    app.use(rateLimit(options));
    app.use(secureHeaders());
    app.get("/", () => "ok");
    app.get("/json", () => ({ a: 1 }));
    return app;
}

// 残りの秒数は、測るタイミングで変わる
const stable = (text: string) => text.replace(/;t=\d+/, ";t=X").replace(/^retry-after: \d+$/im, "retry-after: X");

describe("rateLimit() と Node", () => {
    test("通すリクエストでは Request も Response も作らない", async () => {
        const port = await listen(appWith({ windowMs: 60_000, limit: 100 }));

        const counts = await counting(async () => {
            const text = await raw(port, request("GET", "/"));
            assert.match(text, /^HTTP\/1\.1 200/);
            assert.match(text, /^ratelimit: "default";r=99;t=60$/im);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("本物の接続元で数える。超えたら 429", async () => {
        const port = await listen(appWith({ windowMs: 60_000, limit: 1 }));

        assert.match(await raw(port, request("GET", "/")), /^HTTP\/1\.1 200/);
        const over = await raw(port, request("GET", "/"));
        assert.match(over, /^HTTP\/1\.1 429/);
        assert.match(over, /^retry-after: \d+$/im);
    });

    test("2つの道の応答が同じ(同じ順番で叩く)", async () => {
        const list: [Parameters<typeof rateLimit>[0], Record<string, string>][] = [
            [{ windowMs: 60_000, limit: 2 }, {}],
            [{ windowMs: 60_000, limit: 2, headers: false }, {}],
            [{ windowMs: 60_000, limit: 2, ip: trustProxy({ hops: 1 }) }, { "X-Forwarded-For": "1.1.1.1" }],
            [{ windowMs: 60_000, limit: 2, key: () => "all" }, {}],
        ];
        for (const [options, headers] of list) {
            // 数を分けるために、アプリを2つ作る
            const lazy = await listen(appWith(options));
            const viaFetch = await listen({ fetch: appWith(options).fetch });
            for (const [method, path] of [["GET", "/"], ["GET", "/json"], ["HEAD", "/"], ["GET", "/"]] as const) {
                const text = request(method, path, headers);
                assert.equal(stable(await raw(lazy, text)), stable(await raw(viaFetch, text)), `${method} ${path}`);
            }
        }
    });

    test("IP が分からないときも落ちない(ip が null を返す)", async () => {
        const warn = console.warn;
        console.warn = () => {};
        try {
            const port = await listen(appWith({ windowMs: 60_000, limit: 1, ip: () => null }));

            assert.match(await raw(port, request("GET", "/")), /^HTTP\/1\.1 200/);
            assert.match(await raw(port, request("GET", "/")), /^HTTP\/1\.1 200/);
        } finally {
            console.warn = warn;
        }
    });

    test("タイマーを使わないので、サーバーを閉じれば終わる", async () => {
        const server = serve(appWith({ windowMs: 3_600_000, limit: 1 }), { port: 0, hostname: "127.0.0.1" });
        await new Promise<void>((resolve) => server.once("listening", resolve));
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    });
});
