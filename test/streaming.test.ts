import { describe, expect, spyOn, test } from "bun:test";
import { compress, createApp, etag, type Context } from "../src/index.ts";
import { stream, streamSSE, streamText, type SSEMessage, type StreamingApi } from "../src/streaming.ts";
import { explainText } from "../src/dev/explain.ts";
import { devtools } from "../src/dev/index.ts";
import { bundleOf } from "./bundle.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const req = (path = "/", init?: RequestInit) => new Request(`http://localhost${path}`, init);

function appWith(handler: (c: Context) => Response) {
    const app = createApp();
    app.get("/", (_, c) => handler(c));
    return app;
}
const bytes = (text: string) => new TextEncoder().encode(text);
const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => new TextDecoder().decode((await reader.read()).value);
const CONNECTED = ": connected\n\n";

describe("stream()", () => {
    test("文字列と Uint8Array を順に流す。関数が終われば終わる", async () => {
        const res = await appWith((c) =>
            stream(c, async (s) => {
                await s.write("a");
                await s.write(bytes("b"));
                await s.writeln("c");
            }),
        ).fetch(req());

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/octet-stream");
        expect(await res.text()).toBe("abc\n");
    });

    test("c.status() と c.header() が効く", async () => {
        const res = await appWith((c) => {
            c.status(201);
            c.header("content-type", "application/zip");
            c.header("x-own", "1");
            return stream(c, (s) => s.write("x"));
        }).fetch(req());

        expect(res.status).toBe(201);
        expect(res.headers.get("content-type")).toBe("application/zip");
        expect(res.headers.get("x-own")).toBe("1");
    });

    test("本物の Response を返す", async () => {
        const res = await appWith((c) => stream(c, () => {})).fetch(req());

        expect(Object.getPrototypeOf(res)).toBe(Response.prototype);
    });

    test("pipe で、ストリームを全部流す", async () => {
        const res = await appWith((c) =>
            stream(c, async (s) => {
                await s.write("<");
                await s.pipe(new Response("body").body!);
                await s.write(">");
            }),
        ).fetch(req());

        expect(await res.text()).toBe("<body>");
    });

    test("close で早く終われる。そのあとの write は何もしない", async () => {
        let closed = false;
        const res = await appWith((c) =>
            stream(c, async (s) => {
                await s.write("a");
                s.close();
                closed = s.closed;
                await s.write("b");
            }),
        ).fetch(req());

        expect(await res.text()).toBe("a");
        expect(closed).toBe(true);
    });

    test("読み手が追いつくまで、write は待つ", async () => {
        const order: string[] = [];
        const res = await appWith((c) =>
            stream(c, async (s) => {
                for (let i = 0; i < 3; i++) {
                    await s.write(String(i));
                    order.push(`wrote ${i}`);
                }
            }),
        ).fetch(req());
        await sleep(10);
        expect(order.length).toBeLessThan(3);

        expect(await res.text()).toBe("012");
        expect(order).toEqual(["wrote 0", "wrote 1", "wrote 2"]);
    });
});

describe("切断", () => {
    function controlled() {
        const log: string[] = [];
        let api: StreamingApi | undefined;
        const app = appWith((c) =>
            stream(c, async (s) => {
                api = s;
                s.onAbort(() => void log.push("one"));
                s.onAbort(async () => void log.push("two"));
                await s.write("a");
                await s.sleep(10_000);
                log.push(`woke ${s.aborted}`);
                await s.write("b");
                log.push("end");
            }),
        );
        return { app, log, api: () => api! };
    }

    test("読み手が閉じたら、onAbort を呼んで sleep も起こす", async () => {
        const { app, log, api } = controlled();
        const res = await app.fetch(req());
        const reader = res.body!.getReader();
        await reader.read();
        await reader.cancel();
        await sleep(10);

        expect(api().aborted).toBe(true);
        expect(log).toEqual(["one", "two", "woke true", "end"]);
    });

    test("c.req.signal が abort したら止まる", async () => {
        const { app, log, api } = controlled();
        const controller = new AbortController();
        const res = await app.fetch(req("/", { signal: controller.signal }));
        await res.body!.getReader().read();
        controller.abort();
        await sleep(10);

        expect(api().aborted).toBe(true);
        expect(log).toContain("one");
    });

    test("もう切断していれば、onAbort はすぐ呼ぶ", async () => {
        const seen: string[] = [];
        const controller = new AbortController();
        controller.abort();
        const app = appWith((c) =>
            stream(c, async (s) => {
                seen.push(`aborted ${s.aborted}`);
                s.onAbort(() => void seen.push("called"));
            }),
        );
        await app.fetch(req("/", { signal: controller.signal }));
        await sleep(5);

        expect(seen).toEqual(["aborted true", "called"]);
    });

    test("pipe は、切断したら元のストリームも閉じる", async () => {
        let cancelled = false;
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes("a"));
            },
            cancel() {
                cancelled = true;
            },
        });
        const res = await appWith((c) => stream(c, (s) => s.pipe(source))).fetch(req());
        const reader = res.body!.getReader();
        await reader.read();
        await reader.cancel();
        await sleep(10);

        expect(cancelled).toBe(true);
    });

    test("正常に終わったら、onAbort は呼ばない", async () => {
        let called = false;
        const res = await appWith((c) =>
            stream(c, async (s) => {
                s.onAbort(() => void (called = true));
                await s.write("a");
            }),
        ).fetch(req());
        await res.text();

        expect(called).toBe(false);
    });

    test("onAbort が投げても、ほかの処理は続く", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});
        try {
            const seen: string[] = [];
            const res = await appWith((c) =>
                stream(c, async (s) => {
                    s.onAbort(() => {
                        throw new Error("boom");
                    });
                    s.onAbort(() => Promise.reject(new Error("boom 2")));
                    s.onAbort(() => void seen.push("called"));
                    await s.write("a");
                    await s.sleep(10_000);
                }),
            ).fetch(req());
            const reader = res.body!.getReader();
            await reader.read();
            await reader.cancel();
            await sleep(10);

            expect(seen).toEqual(["called"]);
            expect(error).toHaveBeenCalledTimes(2);
        } finally {
            error.mockRestore();
        }
    });
});

describe("途中のエラー", () => {
    test("onError がなければ、ログに出して接続を切る", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});
        try {
            const res = await appWith((c) =>
                stream(c, async (s) => {
                    await s.write("a");
                    throw new Error("boom");
                }),
            ).fetch(req());

            expect(res.status).toBe(200);
            const reader = res.body!.getReader();
            expect(await read(reader)).toBe("a");
            await expect(reader.read()).rejects.toThrow("boom");
            expect(error).toHaveBeenCalledTimes(1);
        } finally {
            error.mockRestore();
        }
    });

    test("onError があれば、最後に書けて、正常に閉じる", async () => {
        const res = await appWith((c) =>
            stream(
                c,
                async (s) => {
                    await s.write("a");
                    throw new Error("boom");
                },
                { onError: (err, s) => s.write(`[${(err as Error).message}]`) },
            ),
        ).fetch(req());

        expect(await res.text()).toBe("a[boom]");
    });

    test("onError も投げたら、接続を切る", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});
        try {
            const res = await appWith((c) =>
                stream(
                    c,
                    () => {
                        throw new Error("first");
                    },
                    {
                        onError: () => {
                            throw new Error("second");
                        },
                    },
                ),
            ).fetch(req());

            await expect(res.text()).rejects.toThrow("second");
        } finally {
            error.mockRestore();
        }
    });

    test("切断のあとのエラーは、ログに出さない", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});
        try {
            const res = await appWith((c) =>
                stream(c, async (s) => {
                    await s.write("a");
                    await s.sleep(10_000);
                    throw new Error("after abort");
                }),
            ).fetch(req());
            const reader = res.body!.getReader();
            await reader.read();
            await reader.cancel();
            await sleep(10);

            expect(error).not.toHaveBeenCalled();
        } finally {
            error.mockRestore();
        }
    });
});

describe("streamText()", () => {
    test("テキストのヘッダーを付ける", async () => {
        const res = await appWith((c) => streamText(c, (s) => s.writeln("こんにちは"))).fetch(req());

        expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("cache-control")).toBe("no-transform");
        expect(await res.text()).toBe("こんにちは\n");
    });

    test("c.header() の値が勝つ", async () => {
        const res = await appWith((c) => {
            c.header("content-type", "text/markdown");
            c.header("cache-control", "no-store");
            return streamText(c, (s) => s.write("x"));
        }).fetch(req());

        expect(res.headers.get("content-type")).toBe("text/markdown");
        expect(res.headers.get("cache-control")).toBe("no-store");
    });

    test("compress() は圧縮しない(no-transform)", async () => {
        const app = createApp();
        app.use(compress({ threshold: 1 }));
        app.get("/", (_, c) => streamText(c, (s) => s.write("x".repeat(5000))));
        const res = await app.fetch(req("/", { headers: { "accept-encoding": "gzip" } }));

        expect(res.headers.get("content-encoding")).toBeNull();
        expect(await res.text()).toBe("x".repeat(5000));
    });
});

describe("streamSSE()", () => {
    const events = (run: (s: Parameters<Parameters<typeof streamSSE>[1]>[0]) => void | Promise<void>) => appWith((c) => streamSSE(c, run)).fetch(req());

    test("ヘッダー", async () => {
        const res = await events(() => {});

        expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
        expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
        expect(res.headers.get("x-accel-buffering")).toBe("no");
        expect(res.headers.get("connection")).toBeNull();
    });

    test("最初にコメントを送る(ヘッダーがすぐ届くように)", async () => {
        const res = await events(() => sleep(10_000).then(() => {}));
        const reader = res.body!.getReader();

        expect(await read(reader)).toBe(CONNECTED);
        await reader.cancel();
    });

    test.each<[string, SSEMessage, string]>([
        ["data", { data: "hello" }, "data: hello\n\n"],
        ["全部", { event: "tick", id: "7", retry: 1000, data: "x" }, "event: tick\nid: 7\nretry: 1000\ndata: x\n\n"],
        ["複数行(LF)", { data: "a\nb" }, "data: a\ndata: b\n\n"],
        ["複数行(CRLF と CR)", { data: "a\r\nb\rc" }, "data: a\ndata: b\ndata: c\n\n"],
        ["空", { data: "" }, "data: \n\n"],
        ["末尾の改行", { data: "a\n" }, "data: a\ndata: \n\n"],
        ["retry: 0", { data: "x", retry: 0 }, "retry: 0\ndata: x\n\n"],
        ["日本語", { data: "こんにちは" }, "data: こんにちは\n\n"],
    ])("writeSSE: %s", async (_, message, expected) => {
        const res = await events((s) => s.writeSSE(message));

        expect(await res.text()).toBe(CONNECTED + expected);
    });

    test("writeComment", async () => {
        const res = await events((s) => s.writeComment("a\nb"));

        expect(await res.text()).toBe(`${CONNECTED}: a\n: b\n\n`);
    });

    test.each<[string, SSEMessage]>([
        ["event の改行", { event: "a\nb", data: "x" }],
        ["event の CR", { event: "a\rb", data: "x" }],
        ["id の改行", { id: "a\nb", data: "x" }],
        ["id の NUL", { id: "a\0b", data: "x" }],
        ["負の retry", { retry: -1, data: "x" }],
        ["小数の retry", { retry: 1.5, data: "x" }],
        ["data がない", {} as SSEMessage],
    ])("注入できる値はエラー: %s。開発モードの説明がある", async (_, message) => {
        let caught: unknown;
        const res = await appWith((c) =>
            streamSSE(c, (s) => s.writeSSE(message), {
                onError: (err) => {
                    caught = err;
                },
            }),
        ).fetch(req());

        expect(await res.text()).toBe(CONNECTED);
        expect(explainText(caught, "ja")).toContain("writeSSE()");
    });

    test("onError から最後のイベントを送れる", async () => {
        const res = await appWith((c) =>
            streamSSE(
                c,
                () => {
                    throw new Error("boom");
                },
                { onError: (err, s) => s.writeSSE({ event: "error", data: (err as Error).message }) },
            ),
        ).fetch(req());

        expect(await res.text()).toBe(`${CONNECTED}event: error\ndata: boom\n\n`);
    });

    test("heartbeat: コメントを送る。終わったら止まる", async () => {
        const res = await appWith((c) => streamSSE(c, (s) => s.sleep(35), { heartbeat: 10 })).fetch(req());
        const text = await res.text();

        expect(text.startsWith(CONNECTED)).toBe(true);
        expect(text.match(/: ping\n\n/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    });

    test("heartbeat: 既定で、5秒ごとに流れる", async () => {
        const interval = spyOn(globalThis, "setInterval");
        try {
            const res = await appWith((c) => streamSSE(c, () => {})).fetch(req());
            await res.text();

            expect(interval.mock.calls.map((call) => call[1])).toEqual([5000]);
        } finally {
            interval.mockRestore();
        }
    });

    test("heartbeat: false なら流れない。最初のコメントは残る", async () => {
        const interval = spyOn(globalThis, "setInterval");
        try {
            const res = await appWith((c) => streamSSE(c, (s) => s.sleep(30), { heartbeat: false })).fetch(req());

            expect(await res.text()).toBe(CONNECTED);
            expect(interval).not.toHaveBeenCalled();
        } finally {
            interval.mockRestore();
        }
    });

    test("heartbeat: 間隔は設定どおり", async () => {
        const res = await appWith((c) => streamSSE(c, (s) => s.sleep(130), { heartbeat: 40 })).fetch(req());
        const pings = (await res.text()).match(/: ping\n\n/g)?.length ?? 0;

        // 130ms の間に 40ms ごとなら3回(タイマーの遅れで1回減ることはある)
        expect(pings).toBeGreaterThanOrEqual(2);
        expect(pings).toBeLessThanOrEqual(3);
    });

    test("heartbeat: 読み手が止まっている間は、たまらない", async () => {
        const res = await appWith((c) => streamSSE(c, (s) => s.sleep(60), { heartbeat: 5 })).fetch(req());
        await sleep(100);
        const text = await res.text();

        // 読んでいない間のコメント(5ms ごとなら 10 回以上)は、ためない
        expect(text.match(/: ping\n\n/g)?.length ?? 0).toBeLessThanOrEqual(1);
    });

    test("heartbeat: 切断したら止まる", async () => {
        let api: StreamingApi | undefined;
        const res = await appWith((c) =>
            streamSSE(
                c,
                async (s) => {
                    api = s;
                    await s.sleep(10_000);
                },
                { heartbeat: 5 },
            ),
        ).fetch(req());
        const reader = res.body!.getReader();
        await reader.read();
        await reader.cancel();
        await sleep(30);

        expect(api?.aborted).toBe(true);
    });

    test.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY], ["10"]])("heartbeat が不正なら投げる。開発モードの説明がある: %j", async (heartbeat) => {
        let err: unknown;
        const app = appWith((c) => {
            try {
                return streamSSE(c, () => {}, { heartbeat: heartbeat as number });
            } catch (e) {
                err = e;
                throw e;
            }
        });
        await app.fetch(req());

        expect(explainText(err, "ja")).toContain("heartbeat");
        expect(explainText(err, "en")).toContain("heartbeat");
    });

    test("compress() と etag() は触らない。イベントはすぐ届く", async () => {
        const app = createApp();
        app.use(compress({ threshold: 1 }));
        app.use(etag());
        app.get("/", (_, c) => streamSSE(c, (s) => s.sleep(10_000)));
        const start = performance.now();
        const res = await app.fetch(req("/", { headers: { "accept-encoding": "gzip" } }));

        expect(performance.now() - start).toBeLessThan(100);
        expect(res.headers.get("content-encoding")).toBeNull();
        expect(res.headers.get("etag")).toBeNull();
        const reader = res.body!.getReader();
        expect(await read(reader)).toBe(CONNECTED);
        await reader.cancel();
    });

    test("開発モードでも流れる", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.get("/", (_, c) => streamSSE(c, (s) => s.writeSSE({ data: "x" })));
        const res = await app.fetch(req("/", { headers: { host: "localhost" } }));

        expect(await res.text()).toBe(`${CONNECTED}data: x\n\n`);
    });
});

describe("バンドル", () => {
    test("使わなければ、本体に入らない", async () => {
        const code = await bundleOf("createApp");

        expect(code).not.toContain("event-stream");
    });
});
