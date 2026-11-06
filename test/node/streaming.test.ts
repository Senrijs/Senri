// ストリーミングのヘルパーを Node のアダプターで確かめる。最初のイベントが遅れないこと、切断で止まること
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { compress, createApp, etag, secureHeaders } from "../../src/index.ts";
import { stream, streamSSE, streamText } from "../../src/streaming.ts";
import { closeServers, listen, raw, request } from "./http.ts";

after(closeServers);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const eventually = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await sleep(10);
    return check();
};

// 届いたものを、届いた時刻つきで見られるようにする
function connect(port: number, text: string) {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(text));
    const state = { data: "", closed: false, socket };
    socket.on("data", (chunk) => (state.data += chunk.toString("utf8")));
    socket.on("close", () => (state.closed = true));
    socket.on("error", () => {});
    return state;
}

describe("streamSSE() と Node", () => {
    test("ヘッダーと最初のコメントは、イベントより先に届く", async () => {
        const app = createApp();
        app.get("/", (_, c) =>
            streamSSE(c, async (s) => {
                await s.sleep(10_000);
            }),
        );
        const state = connect(await listen(app), request("GET", "/"));

        assert.ok(await eventually(() => state.data.includes(": connected")), state.data);
        assert.match(state.data, /^HTTP\/1\.1 200/);
        assert.match(state.data, /content-type: text\/event-stream; charset=utf-8/i);
        assert.match(state.data, /x-accel-buffering: no/i);
        state.socket.destroy();
    });

    test("最初のイベントは、次のイベントを待たずに届く", async () => {
        const app = createApp();
        app.get("/", (_, c) =>
            streamSSE(c, async (s) => {
                await s.writeSSE({ data: "first" });
                await s.sleep(10_000);
                await s.writeSSE({ data: "second" });
            }),
        );
        const state = connect(await listen(app), request("GET", "/"));

        assert.ok(await eventually(() => state.data.includes("data: first")), state.data);
        assert.ok(!state.data.includes("second"));
        state.socket.destroy();
    });

    test("クライアントが切断したら onAbort を呼ぶ。ループも止まる", async () => {
        let aborted = false;
        let ended = false;
        let writes = 0;
        const app = createApp();
        app.get("/", (_, c) =>
            streamSSE(c, async (s) => {
                s.onAbort(() => void (aborted = true));
                while (!s.aborted) {
                    await s.writeSSE({ data: "x" });
                    writes++;
                    await s.sleep(5);
                }
                ended = true;
            }),
        );
        const state = connect(await listen(app), request("GET", "/"));
        assert.ok(await eventually(() => state.data.includes("data: x")));
        state.socket.destroy();

        assert.ok(await eventually(() => aborted && ended));
        const after = writes;
        await sleep(30);
        assert.equal(writes, after);
    });

    test("compress() は SSE を圧縮しない。純正のミドルウェアと一緒でも遅れない", async () => {
        const app = createApp();
        app.use(compress({ threshold: 1 }));
        app.use(etag());
        app.use(secureHeaders());
        app.get("/", (_, c) => streamSSE(c, (s) => s.sleep(10_000)));
        const state = connect(await listen(app), request("GET", "/", { "Accept-Encoding": "gzip" }));

        assert.ok(await eventually(() => state.data.includes(": connected")), state.data);
        assert.doesNotMatch(state.data, /content-encoding/i);
        assert.doesNotMatch(state.data, /^etag:/im);
        state.socket.destroy();
    });

    test("関数が終われば、レスポンスも終わる", async () => {
        const app = createApp();
        app.get("/", (_, c) => streamSSE(c, (s) => s.writeSSE({ event: "a", data: "x\ny" })));
        const text = await raw(await listen(app), request("GET", "/"));

        assert.ok(text.includes(": connected"));
        assert.ok(text.includes("event: a\r\n".replace("\r", "")));
        assert.ok(text.includes("data: x\ndata: y\n"));
    });

    test("HEAD でも止まる", async () => {
        let aborted = false;
        const app = createApp();
        app.get("/", (_, c) =>
            streamSSE(c, async (s) => {
                s.onAbort(() => void (aborted = true));
                await s.sleep(10_000);
            }),
        );
        const text = await raw(await listen(app), request("HEAD", "/"));

        assert.match(text, /^HTTP\/1\.1 200/);
        assert.ok(await eventually(() => aborted));
    });
});

describe("stream() と Node", () => {
    test("大きなバイト列も全部届く", async () => {
        const chunk = new Uint8Array(64 * 1024).fill(97);
        const app = createApp();
        app.get("/", (_, c) =>
            stream(c, async (s) => {
                for (let i = 0; i < 50; i++) await s.write(chunk);
            }),
        );
        const port = await listen(app);
        const res = await fetch(`http://127.0.0.1:${port}/`);

        assert.equal((await res.arrayBuffer()).byteLength, 64 * 1024 * 50);
    });

    test("読まないクライアントには、書きすぎない", async () => {
        let written = 0;
        let aborted = false;
        const chunk = new Uint8Array(64 * 1024);
        const app = createApp();
        app.get("/", (_, c) =>
            stream(c, async (s) => {
                s.onAbort(() => void (aborted = true));
                while (!s.aborted && written < 2000) {
                    await s.write(chunk);
                    written++;
                }
            }),
        );
        const socket = net.connect(await listen(app), "127.0.0.1", () => socket.write(request("GET", "/")));
        socket.on("error", () => {});
        socket.pause();
        await sleep(300);

        assert.ok(written < 2000, `written ${written}`);
        socket.destroy();
        assert.ok(await eventually(() => aborted));
    });

    test("途中のエラーは接続を切る。正常に終わったように見せない", async () => {
        const quiet = console.error;
        console.error = () => {};
        try {
            const app = createApp();
            app.get("/", (_, c) =>
                stream(c, async (s) => {
                    await s.write("partial");
                    await sleep(5);
                    throw new Error("boom");
                }),
            );
            const text = await raw(await listen(app), request("GET", "/"));

            assert.ok(text.includes("partial"));
            // チャンク転送の終わり(0\r\n\r\n)が来ていない
            assert.ok(!text.endsWith("0\r\n\r\n"), JSON.stringify(text.slice(-20)));
        } finally {
            console.error = quiet;
        }
    });
});

describe("streamText() と Node", () => {
    test("順に届く", async () => {
        const app = createApp();
        app.get("/", (_, c) =>
            streamText(c, async (s) => {
                await s.writeln("one");
                await s.sleep(5);
                await s.writeln("two");
            }),
        );
        const port = await listen(app);

        assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "one\ntwo\n");
    });
});
