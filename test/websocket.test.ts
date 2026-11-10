import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createApp, type App } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { upgradeWebSocket, websocket, type WebSocketEvents } from "../src/websocket.ts";

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true);
});

function listen(app: App, withWebsocket = true): string {
    const server = withWebsocket ? Bun.serve({ port: 0, fetch: app.fetch, websocket }) : Bun.serve({ port: 0, fetch: app.fetch });
    servers.push(server);
    return `ws://localhost:${server.port}`;
}

// つないで、届いたメッセージを順に受け取れるようにする
function connect(url: string, init?: { headers?: Record<string, string> }) {
    const ws = new WebSocket(url, init as never);
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
    const opened = new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("connection failed"));
    });
    const message = async (index: number) => {
        while (messages.length <= index) await new Promise<void>((resolve) => waiting.push(resolve));
        return messages[index];
    };
    return { ws, opened, closed, message };
}

function echoApp(extra: Partial<WebSocketEvents> = {}) {
    const app = createApp();
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
    return app;
}

describe("upgradeWebSocket() / Bun", () => {
    test("つなぐ・あいさつ・文字のエコー・バイナリ(Uint8Array で受け取る)", async () => {
        let received: unknown;
        const app = echoApp({
            onMessage(data, ws) {
                received = data;
                ws.send(typeof data === "string" ? `echo: ${data}` : data);
            },
        });
        const client = connect(`${listen(app)}/ws?name=bun`);
        expect(await client.message(0)).toBe("hello bun");
        client.ws.send("ping");
        expect(await client.message(1)).toBe("echo: ping");
        client.ws.send(new Uint8Array([1, 2, 3]));
        expect([...new Uint8Array((await client.message(2)) as ArrayBuffer)]).toEqual([1, 2, 3]);
        expect(received).toBeInstanceOf(Uint8Array);
        client.ws.close();
    });

    test("onClose に code と reason が届く", async () => {
        let resolveClose!: (value: [number, string]) => void;
        const closed = new Promise<[number, string]>((resolve) => (resolveClose = resolve));
        const app = echoApp({ onClose: (code, reason) => resolveClose([code, reason]) });
        const client = connect(`${listen(app)}/ws`);
        await client.opened;
        client.ws.close(4000, "bye");
        expect(await closed).toEqual([4000, "bye"]);
    });

    test("サーバーから close できる", async () => {
        const app = echoApp({ onOpen: (ws) => ws.close(4001, "done") });
        const client = connect(`${listen(app)}/ws`);
        expect(await client.closed).toEqual({ code: 4001, reason: "done" });
    });

    test("ハンドラーが投げたものは onError に届き、接続は続く", async () => {
        const errors: unknown[] = [];
        const app = echoApp({
            onMessage(data, ws) {
                if (data === "boom") throw new Error("boom");
                ws.send(`echo: ${String(data)}`);
            },
            onError: (error) => void errors.push(error),
        });
        const client = connect(`${listen(app)}/ws`);
        await client.message(0);
        client.ws.send("boom");
        client.ws.send("after");
        expect(await client.message(1)).toBe("echo: after");
        expect((errors[0] as Error).message).toBe("boom");
        client.ws.close();
    });

    test("onError がなければ console.error に出す(reject したものも)", async () => {
        const spy = spyOn(console, "error").mockImplementation(() => {});
        try {
            const app = echoApp({
                async onMessage(_data, ws) {
                    ws.send("before");
                    throw new Error("async boom");
                },
            });
            const client = connect(`${listen(app)}/ws`);
            await client.message(0);
            client.ws.send("x");
            await client.message(1);
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(spy.mock.calls.some((args) => (args[1] as Error)?.message === "async boom")).toBe(true);
            client.ws.close();
        } finally {
            spy.mockRestore();
        }
    });

    test("ミドルウェアが止めたら upgrade しない(create も呼ばない)", async () => {
        let created = false;
        const app = createApp();
        app.use(async (c, next) => (c.req.headers.get("authorization") ? next() : c.text("401 Unauthorized", 401)));
        app.get(
            "/ws",
            upgradeWebSocket(() => {
                created = true;
                return {};
            }),
        );
        const client = connect(`${listen(app)}/ws`);
        await expect(client.opened).rejects.toThrow();
        expect(created).toBe(false);
    });

    test("開発モードでもつながる", async () => {
        const app = createApp({ dev: devtools({ lang: "en" }) });
        app.get("/ws", upgradeWebSocket(() => ({ onOpen: (ws) => ws.send("dev") })));
        const client = connect(`${listen(app)}/ws`);
        expect(await client.message(0)).toBe("dev");
        client.ws.close();
    });

    test("Bun.serve に websocket を渡していなければ 500 で、開発モードで案内する", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.get("/ws", upgradeWebSocket(() => ({})));
        const base = listen(app, false).replace(/^ws/, "http");
        const res = await fetch(`${base}/ws`, {
            headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" },
        });
        expect(res.status).toBe(500);
        expect(await res.text()).toContain("websocket");
    });
});

describe("upgradeWebSocket() の手前の確かめ(どのランタイムでも同じ)", () => {
    const upgradeHeaders = { upgrade: "websocket", connection: "Upgrade" };
    const call = (app: App, headers: Record<string, string>, url = "http://example.com/ws") => app.fetch(new Request(url, { headers }));

    test("Upgrade: websocket でなければ 426 と Upgrade ヘッダー", async () => {
        const res = await call(echoApp(), {});
        expect([res.status, res.headers.get("upgrade")]).toEqual([426, "websocket"]);
    });

    test("よそのオリジンからは 403。同じホストと、Origin のないものは通る(ここでは upgrade できないので 501)", async () => {
        const app = echoApp();
        expect((await call(app, { ...upgradeHeaders, origin: "https://evil.example" })).status).toBe(403);
        expect((await call(app, { ...upgradeHeaders, origin: "http://example.com" })).status).toBe(501);
        expect((await call(app, upgradeHeaders)).status).toBe(501);
    });

    test("origin に入れたオリジンは通る。形がおかしければ TypeError(code: websocket_origin)", async () => {
        const app = createApp();
        app.get("/ws", upgradeWebSocket(() => ({}), { origin: ["https://app.example.com"] }));
        expect((await call(app, { ...upgradeHeaders, origin: "https://app.example.com" })).status).toBe(501);
        expect((await call(app, { ...upgradeHeaders, origin: "https://evil.example" })).status).toBe(403);
        let thrown: unknown;
        try {
            upgradeWebSocket(() => ({}), { origin: "https://app.example.com/" });
        } catch (err) {
            thrown = err;
        }
        expect((thrown as { code?: string }).code).toBe("websocket_origin");
        expect(explainText(thrown, "ja")).toContain("https://example.com");
    });

    test("開発モードでは、403 と 426 に理由を出す", async () => {
        const app = createApp({ dev: devtools({ lang: "en" }) });
        app.get("/ws", upgradeWebSocket(() => ({})));
        const forbidden = await call(app, { ...upgradeHeaders, origin: "https://evil.example" }, "http://localhost/ws");
        expect(await forbidden.text()).toContain("upgradeWebSocket(..., { origin: [...] })");
        const plain = await call(app, {}, "http://localhost/ws");
        expect(await plain.text()).toContain("is a WebSocket route");
    });
});
