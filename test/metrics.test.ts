import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { metrics, metricsHandler, resetMetrics, type MetricsOptions } from "../src/metrics.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";

// performance.now() を、テストが決めた時刻にする(かかった時間で結果を決めないように)
let now = 0;
let clock: ReturnType<typeof spyOn> | undefined;
beforeEach(() => {
    resetMetrics();
    now = 0;
    clock = spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => clock?.mockRestore());

function makeApp(options?: MetricsOptions) {
    const app = createApp();
    app.use(metrics(options));
    app.get("/metrics", metricsHandler());
    return app;
}

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

async function scrape(app: ReturnType<typeof makeApp>) {
    const res = await app.fetch(req("/metrics"));
    expect(res.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
    return (await res.text()).split("\n");
}

// "名前{ラベル} 値" の行から、値を取り出す
const valueOf = (lines: string[], prefix: string) => {
    const line = lines.find((l) => l.startsWith(`${prefix} `));
    return line === undefined ? undefined : Number(line.slice(prefix.length + 1));
};

describe("metrics() / metricsHandler()", () => {
    test("ルートのパターンと method と status ごとに、件数と合計時間を数える", async () => {
        const app = makeApp();
        app.get("/users/:id", async () => {
            now += 30;
            return "user";
        });
        await app.fetch(req("/users/1"));
        await app.fetch(req("/users/2"));
        const lines = await scrape(app);
        const labels = 'method="GET",route="/users/:id",status="200"';
        expect(valueOf(lines, `http_server_request_duration_seconds_count{${labels}}`)).toBe(2);
        expect(valueOf(lines, `http_server_request_duration_seconds_sum{${labels}}`)).toBeCloseTo(0.06);
        // パスそのものはラベルにしない
        expect(lines.some((l) => l.includes("/users/1"))).toBe(false);
    });

    test("ヒストグラムのバケットは累積で、+Inf が全件", async () => {
        const app = makeApp({ buckets: [0.01, 0.1, 1] });
        const waits = [5, 50, 500, 5000];
        app.get("/wait/:i", ({ i }) => {
            now += waits[Number(i)]!;
            return "ok";
        });
        for (let i = 0; i < waits.length; i++) await app.fetch(req(`/wait/${i}`));
        const lines = await scrape(app);
        const labels = 'method="GET",route="/wait/:i",status="200"';
        const bucket = (le: string) => valueOf(lines, `http_server_request_duration_seconds_bucket{${labels},le="${le}"}`);
        expect([bucket("0.01"), bucket("0.1"), bucket("1"), bucket("+Inf")]).toEqual([1, 2, 3, 4]);
    });

    test("ルートがなければ route=\"unmatched\"、知らないメソッドは _OTHER", async () => {
        const app = makeApp();
        await app.fetch(req("/nope"));
        await app.fetch(req("/nope", { method: "PROPFIND" }));
        const lines = await scrape(app);
        expect(valueOf(lines, 'http_server_request_duration_seconds_count{method="GET",route="unmatched",status="404"}')).toBe(1);
        expect(lines.some((l) => l.includes('method="_OTHER"'))).toBe(true);
        expect(lines.some((l) => l.includes("PROPFIND"))).toBe(false);
    });

    test("例外は onError の status(500)で数える", async () => {
        const app = makeApp();
        app.get("/boom", () => {
            throw new Error("boom");
        });
        await app.fetch(req("/boom"));
        expect(valueOf(await scrape(app), 'http_server_request_duration_seconds_count{method="GET",route="/boom",status="500"}')).toBe(1);
    });

    test("処理中の数(gauge)。終われば戻る", async () => {
        const app = makeApp();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        app.post("/slow", async () => {
            await gate;
            return "done";
        });
        const pending = app.fetch(req("/slow", { method: "POST" }));
        await Promise.resolve();
        const during = await scrape(app);
        expect(valueOf(during, 'http_server_active_requests{method="POST"}')).toBe(1);
        release();
        await pending;
        expect(valueOf(await scrape(app), 'http_server_active_requests{method="POST"}')).toBe(0);
    });

    test("Prometheus のテキスト形式になっている(HELP・TYPE・行の形)", async () => {
        const app = makeApp();
        app.get("/a", () => "a");
        await app.fetch(req("/a"));
        const lines = (await scrape(app)).filter(Boolean);
        expect(lines).toContain("# TYPE http_server_request_duration_seconds histogram");
        expect(lines).toContain("# TYPE http_server_active_requests gauge");
        for (const line of lines.filter((l) => !l.startsWith("#"))) {
            expect(line).toMatch(/^[a-z_]+\{([a-z_]+="(?:[^"\\\n]|\\.)*",?)+\} [0-9.e+-]+$/);
        }
    });

    test("ラベルの値の \\ と \" をエスケープする", async () => {
        const app = makeApp();
        app.get('/q/a"b\\c', () => "ok");
        await app.fetch(req("/q/a%22b%5Cc"));
        const lines = await scrape(app);
        expect(lines.some((l) => l.includes('route="/q/a\\"b\\\\c"'))).toBe(true);
    });

    test("buckets がおかしければ RangeError(code: metrics_buckets)", () => {
        for (const buckets of [[], [0.1, 0.1], [1, 0.5], [0], [-1], [Infinity], ["1"]]) {
            let thrown: unknown;
            try {
                metrics({ buckets: buckets as number[] });
            } catch (err) {
                thrown = err;
            }
            expect(thrown).toBeInstanceOf(RangeError);
            expect((thrown as { code?: string }).code).toBe("metrics_buckets");
            expect(explainText(thrown, "ja")).toContain("buckets");
        }
    });

    test("Node の近道で使える(markPlainSafe)", () => {
        expect(isPlainSafe(metrics())).toBe(true);
    });
});
