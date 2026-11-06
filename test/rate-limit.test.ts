import { afterEach, beforeEach, describe, expect, spyOn, setSystemTime, test } from "bun:test";
import { createApp, HttpError, rateLimit, type RateLimitOptions, type RateLimitStore } from "../src/index.ts";
import { trustProxy } from "../src/ip.ts";
import { explainText } from "../src/dev/explain.ts";
import { memoryStore } from "../src/middleware/rate-limit.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf } from "./bundle.ts";

const START = new Date("2026-01-01T00:00:00Z");

function appWith(options: RateLimitOptions) {
    const app = createApp();
    app.use(rateLimit(options));
    app.get("/", () => "ok");
    return app;
}

const hit = (app: ReturnType<typeof appWith>, peer: string | null = "192.0.2.1", headers: Record<string, string> = {}) =>
    app.fetch(new Request("http://localhost/", { headers }), peer === null ? undefined : { remoteAddr: { hostname: peer } });

beforeEach(() => {
    setSystemTime(START);
});
afterEach(() => {
    setSystemTime();
});

describe("rateLimit()", () => {
    test("limit までは通して、超えたら 429 と Retry-After", async () => {
        const app = appWith({ windowMs: 60_000, limit: 2 });

        expect((await hit(app)).status).toBe(200);
        expect((await hit(app)).status).toBe(200);
        const res = await hit(app);
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("60");
        expect(await res.text()).toBe("429 Too Many Requests");
    });

    test("超えたらハンドラーは動かない", async () => {
        let count = 0;
        const app = createApp();
        app.use(rateLimit({ windowMs: 1000, limit: 1 }));
        app.get("/", () => {
            count++;
            return "ok";
        });
        await hit(app);
        await hit(app);

        expect(count).toBe(1);
    });

    test("ウィンドウが終われば、また通る", async () => {
        const app = appWith({ windowMs: 1000, limit: 1 });
        await hit(app);
        expect((await hit(app)).status).toBe(429);

        setSystemTime(new Date(START.getTime() + 999));
        expect((await hit(app)).status).toBe(429);
        setSystemTime(new Date(START.getTime() + 1000));
        expect((await hit(app)).status).toBe(200);
    });

    test("Retry-After は残りの秒数(切り上げ、最低 1)", async () => {
        const app = appWith({ windowMs: 10_000, limit: 1 });
        await hit(app);

        setSystemTime(new Date(START.getTime() + 2500));
        expect((await hit(app)).headers.get("retry-after")).toBe("8");
        setSystemTime(new Date(START.getTime() + 9999));
        expect((await hit(app)).headers.get("retry-after")).toBe("1");
    });

    test("キーごとに数える", async () => {
        const app = appWith({ windowMs: 1000, limit: 1 });

        expect((await hit(app, "192.0.2.1")).status).toBe(200);
        expect((await hit(app, "192.0.2.2")).status).toBe(200);
        expect((await hit(app, "192.0.2.1")).status).toBe(429);
    });

    test("IPv6 は /64 ごとにまとめる。書き方の違いを問わない", async () => {
        const app = appWith({ windowMs: 1000, limit: 1 });

        expect((await hit(app, "2001:db8:1:2::a")).status).toBe(200);
        expect((await hit(app, "2001:db8:1:2:ffff::b")).status).toBe(429);
        expect((await hit(app, "2001:DB8:1:2:0:0:0:1")).status).toBe(429);
        expect((await hit(app, "2001:db8:1:3::a")).status).toBe(200);
    });

    test("射影アドレスは IPv4 として数える", async () => {
        const app = appWith({ windowMs: 1000, limit: 1 });

        expect((await hit(app, "192.0.2.1")).status).toBe(200);
        expect((await hit(app, "::ffff:192.0.2.1")).status).toBe(429);
    });

    test("trustProxy() の関数で、クライアントごとに数える", async () => {
        const app = appWith({ windowMs: 1000, limit: 1, ip: trustProxy({ hops: 1 }) });
        const from = (client: string) => hit(app, "10.0.0.1", { "x-forwarded-for": `6.6.6.6, ${client}` });

        expect((await from("1.1.1.1")).status).toBe(200);
        expect((await from("2.2.2.2")).status).toBe(200);
        expect((await from("1.1.1.1")).status).toBe(429);
    });

    describe("IP が分からないとき", () => {
        test("制限せずに通して、最初の1回だけ警告する", async () => {
            const warn = spyOn(console, "warn").mockImplementation(() => {});
            try {
                const app = appWith({ windowMs: 1000, limit: 1 });
                for (let i = 0; i < 3; i++) {
                    const res = await hit(app, null);

                    expect(res.status).toBe(200);
                    expect(res.headers.get("ratelimit")).toBeNull();
                }
                expect(warn).toHaveBeenCalledTimes(1);
                expect(String(warn.mock.calls[0]![0])).toContain("rateLimit()");
            } finally {
                warn.mockRestore();
            }
        });

        test("ip が読めない値を返しても同じ", async () => {
            const warn = spyOn(console, "warn").mockImplementation(() => {});
            try {
                const app = appWith({ windowMs: 1000, limit: 1, ip: () => "evil" });

                expect((await hit(app)).status).toBe(200);
                expect((await hit(app)).status).toBe(200);
                expect(warn).toHaveBeenCalledTimes(1);
            } finally {
                warn.mockRestore();
            }
        });
    });

    describe("key", () => {
        test("key で数える単位を変えられる。c を受け取る。非同期でもよい", async () => {
            const app = appWith({ windowMs: 1000, limit: 1, key: async (c) => c.req.headers.get("x-user") });
            const as = (user: string) => hit(app, "192.0.2.1", { "x-user": user });

            expect((await as("a")).status).toBe(200);
            expect((await as("b")).status).toBe(200);
            expect((await as("a")).status).toBe(429);
        });

        test("key が null なら数えない。警告もしない", async () => {
            const warn = spyOn(console, "warn").mockImplementation(() => {});
            try {
                const app = appWith({ windowMs: 1000, limit: 1, key: () => null });

                expect((await hit(app)).status).toBe(200);
                expect((await hit(app)).status).toBe(200);
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });

        test("固定の値を返せば、全員で1つのバケツ", async () => {
            const app = appWith({ windowMs: 1000, limit: 1, key: () => "all" });

            expect((await hit(app, "192.0.2.1")).status).toBe(200);
            expect((await hit(app, "192.0.2.2")).status).toBe(429);
        });

        test("key が投げたら通さない(500)", async () => {
            const app = appWith({
                windowMs: 1000,
                limit: 1,
                key: () => {
                    throw new Error("boom");
                },
            });

            expect((await hit(app)).status).toBe(500);
        });
    });

    describe("ヘッダー", () => {
        test("RateLimit と RateLimit-Policy を付ける(IETF の案)", async () => {
            const app = appWith({ windowMs: 60_000, limit: 2 });
            const first = await hit(app);

            expect(first.headers.get("ratelimit-policy")).toBe('"default";q=2;w=60');
            expect(first.headers.get("ratelimit")).toBe('"default";r=1;t=60');
            expect(first.headers.get("retry-after")).toBeNull();

            setSystemTime(new Date(START.getTime() + 10_000));
            expect((await hit(app)).headers.get("ratelimit")).toBe('"default";r=0;t=50');

            const over = await hit(app);
            expect(over.headers.get("ratelimit")).toBe('"default";r=0;t=50');
            expect(over.headers.get("ratelimit-policy")).toBe('"default";q=2;w=60');
        });

        test("w は 1 秒より短くならない", async () => {
            expect((await hit(appWith({ windowMs: 100, limit: 1 }))).headers.get("ratelimit-policy")).toBe('"default";q=1;w=1');
        });

        test("headers: false なら付けない。Retry-After は付ける", async () => {
            const app = appWith({ windowMs: 1000, limit: 1, headers: false });
            const first = await hit(app);
            const over = await hit(app);

            expect(first.headers.get("ratelimit")).toBeNull();
            expect(first.headers.get("ratelimit-policy")).toBeNull();
            expect(over.status).toBe(429);
            expect(over.headers.get("ratelimit")).toBeNull();
            expect(over.headers.get("retry-after")).toBe("1");
        });

        test("onError で本文を変えても、ヘッダーは残る", async () => {
            const app = appWith({ windowMs: 1000, limit: 1 });
            app.onError((err) => ({ status: err instanceof HttpError ? err.status : 0 }));
            await hit(app);
            const res = await hit(app);

            expect(res.status).toBe(429);
            expect(await res.json()).toEqual({ status: 429 });
            expect(res.headers.get("retry-after")).toBe("1");
            expect(res.headers.get("ratelimit")).toBe('"default";r=0;t=1');
        });
    });

    describe("保存先", () => {
        test("差し替えられる。同期でも非同期でもよい", async () => {
            const seen: [string, number][] = [];
            const counts = new Map<string, number>();
            const increment = (key: string, windowMs: number) => {
                seen.push([key, windowMs]);
                const count = (counts.get(key) ?? 0) + 1;
                counts.set(key, count);
                return { count, resetAt: Date.now() + 5000 };
            };
            const stores: RateLimitStore[] = [{ increment }, { increment: async (key, windowMs) => increment(key, windowMs) }];
            for (const store of stores) {
                counts.clear();
                const app = appWith({ windowMs: 1000, limit: 1, store });

                expect((await hit(app)).status).toBe(200);
                const over = await hit(app);
                expect(over.status).toBe(429);
                expect(over.headers.get("retry-after")).toBe("5");
            }
            expect(seen[0]).toEqual(["192.0.2.1", 1000]);
        });

        test("保存先が投げたら、onError に届く", async () => {
            const app = appWith({
                windowMs: 1000,
                limit: 1,
                store: {
                    increment: () => Promise.reject(new Error("redis down")),
                },
            });
            const errors: string[] = [];
            app.onError((err) => {
                errors.push((err as Error).message);
                return "error";
            });

            expect((await hit(app)).status).toBe(500);
            expect(errors).toEqual(["redis down"]);
        });

        test("resetAt が過ぎていても、Retry-After は 1 以上", async () => {
            const app = appWith({ windowMs: 1000, limit: 1, store: { increment: () => ({ count: 2, resetAt: 0 }) } });

            expect((await hit(app)).headers.get("retry-after")).toBe("1");
        });
    });

    describe("メモリの保存先", () => {
        test("期限が切れたものは、次のリクエストで消える", () => {
            const store = memoryStore(1000);
            for (let i = 0; i < 1000; i++) store.increment(`k${i}`, 1000);
            setSystemTime(new Date(START.getTime() + 1000));
            store.increment("new", 1000);

            // 全部期限切れなので、どれも新しいウィンドウ
            expect((store.increment("k0", 1000) as { count: number }).count).toBe(1);
            expect((store.increment("k999", 1000) as { count: number }).count).toBe(1);
        });

        test("上限を超えたら、いちばん古いキーを忘れる", () => {
            const store = memoryStore(2);
            const count = (key: string) => (store.increment(key, 1000) as { count: number }).count;

            expect(count("a")).toBe(1);
            expect(count("b")).toBe(1);
            expect(count("a")).toBe(2);
            expect(count("c")).toBe(1);
            // a が消えて、b と c が残る
            expect(count("b")).toBe(2);
            expect(count("a")).toBe(1);
        });

        test("たくさんのキーでも、上限より増えない", () => {
            const store = memoryStore(100);
            for (let i = 0; i < 100_000; i++) store.increment(`k${i}`, 60_000);

            // 上限を超えた古いキーは忘れている。直近のキーは覚えている
            expect((store.increment("k0", 60_000) as { count: number }).count).toBe(1);
            expect((store.increment("k99999", 60_000) as { count: number }).count).toBe(2);
        });

        test("maxKeys をオプションで変えられる", async () => {
            const app = appWith({ windowMs: 1000, limit: 1, maxKeys: 1 });

            expect((await hit(app, "192.0.2.1")).status).toBe(200);
            expect((await hit(app, "192.0.2.2")).status).toBe(200);
            // 192.0.2.1 は忘れられている
            expect((await hit(app, "192.0.2.1")).status).toBe(200);
        });

        test("rateLimit() ごとに別の保存先", async () => {
            const a = appWith({ windowMs: 1000, limit: 1 });
            const b = appWith({ windowMs: 1000, limit: 1 });

            expect((await hit(a)).status).toBe(200);
            expect((await hit(b)).status).toBe(200);
        });
    });

    test.each([
        [{}],
        [{ windowMs: 1000 }],
        [{ limit: 1 }],
        [{ windowMs: 0, limit: 1 }],
        [{ windowMs: -1, limit: 1 }],
        [{ windowMs: Number.POSITIVE_INFINITY, limit: 1 }],
        [{ windowMs: "1000", limit: 1 }],
        [{ windowMs: 1000, limit: 0 }],
        [{ windowMs: 1000, limit: 1.5 }],
        [{ windowMs: 1000, limit: "1" }],
        [{ windowMs: 1000, limit: 1, maxKeys: 0 }],
        [{ windowMs: 1000, limit: 1, store: {} }],
    ])("設定が不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            rateLimit(options as RateLimitOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err)).toContain("rateLimit()");
    });

    test("名前と印", () => {
        const middleware = rateLimit({ windowMs: 1, limit: 1 });

        expect(middleware.name).toBe("rateLimit");
        expect(isPlainSafe(middleware)).toBe(true);
    });

    test("使わなければ、本体に入らない", async () => {
        expect((await bundleOf("createApp")).toLowerCase()).not.toContain("ratelimit");
    });
});
