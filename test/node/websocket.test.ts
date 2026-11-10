// upgradeWebSocket() を Node.js で確かめる。フレームを読むのは ws パッケージ(devDependencies)
import { after, afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { upgradeWebSocket, type WebSocketEvents } from "../../src/websocket.ts";
import { serve } from "../../adapters/node/index.ts";
import { closeServers, raw } from "./http.ts";

const servers: ReturnType<typeof serve>[] = [];
after(closeServers);
afterEach(() => {
    for (const server of servers.splice(0)) server.closeAllConnections(), server.close();
});

async function listen(app: Parameters<typeof serve>[0], webSocketServer?: WebSocketServer): Promise<number> {
    const server = serve(app, { port: 0, hostname: "127.0.0.1", webSocketServer });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return (server.address() as { port: number }).port;
}

const wss = (maxPayload = 1024 * 1024) => new WebSocketServer({ noServer: true, maxPayload });

function echoApp(extra: Partial<WebSocketEvents> = {}, dev = false) {
    const app = createApp(dev ? { dev: devtools({ lang: "en" }) } : {});
    app.get(
        "/ws",
        upgradeWebSocket((c) => ({
            onOpen(ws) {
                ws.send(`hello ${c.query("name") ?? "guest"}`);
            },
            onMessage(data, ws) {
                ws.send(typeof data === "string" ? `echo: ${data}` : data);
            },
            ...extra,
        })),
    );
    app.get("/plain", () => "plain");
    return app;
}

function connect(url: string) {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const messages: unknown[] = [];
    const waiting: (() => void)[] = [];
    ws.onmessage = (event) => {
        messages.push(event.data);
        for (const wake of waiting.splice(0)) wake();
    };
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.onclose = (event) => resolve({ code: event.code, reason: event.reason });
    });
    const message = async (index: number) => {
        while (messages.length <= index) await new Promise<void>((resolve) => waiting.push(resolve));
        return messages[index];
    };
    return { ws, closed, message };
}

const upgradeRequest = (path: string, headers: Record<string, string> = {}) =>
    `GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n` +
    `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join("")}\r\n`;

describe("upgradeWebSocket() / Node.js(ws)", () => {
    test("つなぐ・あいさつ・文字のエコー・バイナリ。ws の connection イベントも出る", async () => {
        const server = wss();
        let connections = 0;
        server.on("connection", () => connections++);
        let received: unknown;
        const port = await listen(
            echoApp({
                onMessage(data, ws) {
                    received = data;
                    ws.send(typeof data === "string" ? `echo: ${data}` : data);
                },
            }),
            server,
        );
        const client = connect(`ws://127.0.0.1:${port}/ws?name=node`);
        assert.equal(await client.message(0), "hello node");
        client.ws.send("ping");
        assert.equal(await client.message(1), "echo: ping");
        client.ws.send(new Uint8Array([1, 2, 3]));
        assert.deepEqual([...new Uint8Array((await client.message(2)) as ArrayBuffer)], [1, 2, 3]);
        assert.ok(received instanceof Uint8Array);
        assert.equal(connections, 1);
        client.ws.close();
        await client.closed;
    });

    test("onClose に code と reason が届く", async () => {
        let resolveClose!: (value: [number, string]) => void;
        const closed = new Promise<[number, string]>((resolve) => (resolveClose = resolve));
        const port = await listen(echoApp({ onClose: (code, reason) => resolveClose([code, reason]) }), wss());
        const client = connect(`ws://127.0.0.1:${port}/ws`);
        await client.message(0);
        client.ws.close(4000, "bye");
        assert.deepEqual(await closed, [4000, "bye"]);
    });

    test("maxPayload を超えるメッセージは、ws が 1009 で閉じる(onError にも届く)", async () => {
        const errors: unknown[] = [];
        const port = await listen(echoApp({ onError: (error) => void errors.push(error) }), wss(16));
        const client = connect(`ws://127.0.0.1:${port}/ws`);
        await client.message(0);
        client.ws.send("x".repeat(100));
        assert.equal((await client.closed).code, 1009);
        assert.match(String(errors[0]), /Max payload/);
    });

    test("ハンドラーが投げても、プロセスは落ちない(onError がなければ console.error)", async () => {
        const error = mock.method(console, "error", () => {});
        try {
            const port = await listen(
                echoApp({
                    onMessage(data, ws) {
                        if (data === "boom") throw new Error("boom");
                        ws.send(`echo: ${String(data)}`);
                    },
                }),
                wss(),
            );
            const client = connect(`ws://127.0.0.1:${port}/ws`);
            await client.message(0);
            client.ws.send("boom");
            client.ws.send("after");
            assert.equal(await client.message(1), "echo: after");
            assert.ok(error.mock.calls.some((call) => (call.arguments[1] as Error)?.message === "boom"));
            client.ws.close();
            await client.closed;
        } finally {
            error.mock.restore();
        }
    });

    test("ミドルウェアが止めたら upgrade せず、その応答を返して閉じる", async () => {
        const app = createApp();
        let created = false;
        app.use(async (c, next) => (c.req.headers.get("authorization") ? next() : c.text("401 Unauthorized", 401)));
        app.get(
            "/ws",
            upgradeWebSocket(() => {
                created = true;
                return {};
            }),
        );
        const port = await listen(app, wss());
        const response = await raw(port, upgradeRequest("/ws"));
        assert.match(response, /^HTTP\/1\.1 401 /);
        assert.match(response, /401 Unauthorized$/);
        assert.equal(created, false);
    });

    test("よそのオリジンは 403。同じホストはつながる", async () => {
        const port = await listen(echoApp(), wss());
        assert.match(await raw(port, upgradeRequest("/ws", { Origin: "https://evil.example" })), /^HTTP\/1\.1 403 /);
        const ok = await new Promise<string>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
            ws.onmessage = (event) => {
                resolve(String(event.data));
                ws.close();
            };
        });
        assert.equal(ok, "hello guest");
    });

    test("WebSocket でない Upgrade や、ほかのルートへの Upgrade は、ふつうに答えて閉じる", async () => {
        const port = await listen(echoApp(), wss());
        assert.match(await raw(port, upgradeRequest("/plain")), /^HTTP\/1\.1 200 [\s\S]*plain$/);
        const h2c = "GET /plain HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: h2c\r\n\r\n";
        assert.match(await raw(port, h2c), /^HTTP\/1\.1 200 [\s\S]*plain$/);
        assert.match(await raw(port, upgradeRequest("/missing")), /^HTTP\/1\.1 404 /);
    });

    test("webSocketServer を渡していなければ 500。開発モードでは案内を出す", async () => {
        const quiet = mock.method(console, "error", () => {});
        try {
            const port = await listen(echoApp({}, true));
            const response = await raw(port, upgradeRequest("/ws", { Accept: "text/plain" }));
            assert.match(response, /^HTTP\/1\.1 500 /);
            assert.match(response, /webSocketServer/);
            const production = await listen(echoApp());
            assert.match(await raw(production, upgradeRequest("/ws")), /^HTTP\/1\.1 500 [\s\S]*500 Internal Server Error$/);
        } finally {
            quiet.mock.restore();
        }
    });
});

describe("maxPayload の注意(開発モード)", () => {
    const warnings = async (app: Parameters<typeof serve>[0], server: WebSocketServer) => {
        const warn = mock.method(console, "warn", () => {});
        try {
            await listen(app, server);
            return warn.mock.calls.map((call) => String(call.arguments[0]));
        } finally {
            warn.mock.restore();
        }
    };

    test("開発モードで、maxPayload が ws の既定(100 MiB)のままなら注意する", async () => {
        const messages = await warnings(echoApp({}, true), new WebSocketServer({ noServer: true }));
        assert.equal(messages.filter((m) => m.includes("maxPayload")).length, 1);
    });

    test("maxPayload を付けていれば、注意しない", async () => {
        const messages = await warnings(echoApp({}, true), wss());
        assert.equal(messages.filter((m) => m.includes("maxPayload")).length, 0);
    });

    test("本番(開発モードでない)では、注意しない", async () => {
        const messages = await warnings(echoApp(), new WebSocketServer({ noServer: true }));
        assert.equal(messages.filter((m) => m.includes("maxPayload")).length, 0);
    });
});
