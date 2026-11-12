/**
 * WebSocket routes that work the same on Bun, Deno, Node.js and Cloudflare Workers.
 *
 * - Bun: `serve()` from `@senrijs/senri/serve` sets it up. With `Bun.serve`, pass `websocket` from this entry:
 *   `Bun.serve({ fetch: app.fetch, websocket })`
 * - Deno and Cloudflare Workers: nothing to set up
 * - Node.js: Senri does not read WebSocket frames itself. Install the `ws` package and pass its server to `serve()`:
 *   `serve(app, { webSocketServer: new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }) })`
 * - Browsers (Service Worker): not available (answers 501)
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { upgradeWebSocket } from "@senrijs/senri/websocket";
 *
 * const app = createApp();
 * app.get(
 *     "/echo",
 *     upgradeWebSocket(() => ({
 *         onMessage(data, ws) {
 *             ws.send(data);
 *         },
 *     })),
 * );
 * ```
 *
 * @module
 */
// WebSocket のルート。ランタイムごとの違い(Bun の server.upgrade、Deno.upgradeWebSocket、Workers の WebSocketPair、
// Node.js の ws パッケージ)を、ここで吸収する。フレームを読む処理は書かない(ランタイムか ws に任せる)
import { connectionOf, type Context } from "./context.ts";
import { HttpError, senriError } from "./errors.ts";
import { originMatcher, sameHost, type OriginOption } from "./middleware/origin.ts";

export type { OriginOption } from "./middleware/origin.ts";

/** A message received from the client: text as a string, binary as a `Uint8Array`. */
export type WebSocketData = string | Uint8Array;

/** The connection passed to the event handlers. The same on every runtime. */
export type WSConnection = {
    /** Sends text or binary data. */
    send(data: string | ArrayBuffer | ArrayBufferView): void;
    /** Closes the connection. */
    close(code?: number, reason?: string): void;
    /** `0` connecting, `1` open, `2` closing, `3` closed (as in the browser's `WebSocket`). */
    readonly readyState: number;
    /** The runtime's own socket (Bun's `ServerWebSocket`, Deno's or Workers' `WebSocket`, or a `ws` socket). */
    readonly raw: unknown;
};

/** The event handlers of a WebSocket connection. Errors they throw (or reject with) go to `onError`. */
export type WebSocketEvents = {
    /** The connection is open. */
    onOpen?(ws: WSConnection): void | Promise<void>;
    /** A message arrived. */
    onMessage?(data: WebSocketData, ws: WSConnection): void | Promise<void>;
    /** The connection closed. */
    onClose?(code: number, reason: string, ws: WSConnection): void | Promise<void>;
    /** The connection failed, or another handler threw. Without it, errors are logged with `console.error`. */
    onError?(error: unknown, ws: WSConnection): void | Promise<void>;
};

/** Options for {@link upgradeWebSocket}. */
export type UpgradeWebSocketOptions = {
    // よそのオリジンのページからでもつながせるもの。省略すると、同じホストからだけ
    /**
     * Other origins whose pages may connect, such as `"https://app.example.com"`, or a function that decides.
     * By default, browsers may connect only from a page on the same host (the `Origin` header's host and port must match
     * the `Host` header), to block cross-site WebSocket hijacking. Requests without `Origin` (not from a browser) are
     * allowed, as with `csrf()`.
     */
    origin?: OriginOption;
};

// --- Node.js(@senrijs/senri/node のアダプターとのやり取り。利用者には見せない) ---

/** @internal Node のアダプターが、upgrade のリクエストの info に入れるもの */
export const NODE_UPGRADE: unique symbol = Symbol("senri.nodeUpgrade");
/** @internal アダプターが upgrade するかを見分ける印(レスポンスのヘッダー。クライアントには送らない) */
export const UPGRADE_MARKER = "x-senri-websocket-upgrade";

/** @internal */
export type NodeUpgradeSlot = {
    // serve() に渡された ws の WebSocketServer。渡されていなければ null
    server: unknown;
    // upgradeWebSocket() が入れる。アダプターは、これがあって印のあるレスポンスのときだけ upgrade する
    pending?: WebSocketEvents;
};

// ws パッケージのソケットのうち、使うところ
type NodeSocket = {
    readonly readyState: number;
    send(data: string | ArrayBuffer | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    on(event: "message", listener: (data: unknown, isBinary: boolean) => void): unknown;
    on(event: "close", listener: (code: number, reason: Uint8Array) => void): unknown;
    on(event: "error", listener: (error: unknown) => void): unknown;
};

/** @internal ws の WebSocketServer が upgrade したソケットに、イベントをつなぐ(Node のアダプターが呼ぶ) */
export function attachNodeSocket(events: WebSocketEvents, socket: NodeSocket): void {
    const ws = wrap(socket, () => socket.readyState);
    const emit = emitter(events, ws);
    socket.on("message", (data, isBinary) => emit.message(isBinary ? toData(data) : textOf(data)));
    socket.on("close", (code, reason) => emit.close(code, new TextDecoder().decode(reason)));
    socket.on("error", (error) => emit.error(error));
    emit.open();
}

// --- Bun ---

const BUN_EVENTS: unique symbol = Symbol("senri.bunEvents");

type BunSocket = {
    readonly readyState: number;
    readonly data: { [BUN_EVENTS]?: BunState };
    // Bun の ServerWebSocket の send は Blob なども受ける。Bun.serve の型に合うよう、ここでは広く受ける
    send(data: any): unknown;
    close(code?: number, reason?: string): void;
};
type BunState = { events: WebSocketEvents; emit?: Emitter };

// JSR の slow types のチェック(公開する値には型を書く)のため、websocket の型を書いて出す
// 中の印(BUN_EVENTS)を見せないよう、公開の型では data を unknown にして、中で BunSocket として読む(型だけ。実行時は同じ)
/** The part of Bun's `ServerWebSocket` that {@link websocket} uses. */
export type BunServerWebSocket = {
    /** The state of the connection (`WebSocket.OPEN` and so on). */
    readonly readyState: number;
    /** The `data` given to `server.upgrade()`. */
    readonly data: unknown;
    /** Sends a message. */
    send(data: any): unknown;
    /** Closes the connection. */
    close(code?: number, reason?: string): void;
};

/** The type of {@link websocket}: the `websocket` handlers for `Bun.serve`. */
export type BunWebSocketHandlers = {
    /** Called when a connection opens. */
    open(socket: BunServerWebSocket): void;
    /** Called for each message. */
    message(socket: BunServerWebSocket, message: string | Uint8Array): void;
    /** Called when a connection closes. */
    close(socket: BunServerWebSocket, code: number, reason: string): void;
};

/**
 * The `websocket` handlers to pass to `Bun.serve` when you call it yourself:
 * `Bun.serve({ fetch: app.fetch, websocket })`. `serve()` from `@senrijs/senri/serve` passes it for you.
 */
export const websocket: BunWebSocketHandlers = {
    open(raw) {
        const socket = raw as BunSocket;
        const state = socket.data?.[BUN_EVENTS];
        if (!state) return;
        state.emit = emitter(
            state.events,
            wrap(socket, () => socket.readyState),
        );
        state.emit.open();
    },
    message(socket, message) {
        (socket as BunSocket).data?.[BUN_EVENTS]?.emit?.message(typeof message === "string" ? message : toData(message));
    },
    close(socket, code, reason) {
        (socket as BunSocket).data?.[BUN_EVENTS]?.emit?.close(code, reason ?? "");
    },
};

// --- 共通 ---

function wrap(socket: { send(data: string | ArrayBuffer | ArrayBufferView): unknown; close(code?: number, reason?: string): void }, readyState: () => number): WSConnection {
    return {
        send: (data) => void socket.send(data),
        close: (code, reason) => socket.close(code, reason),
        get readyState() {
            return readyState();
        },
        raw: socket,
    };
}

function toData(data: unknown): WebSocketData {
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    // ws が分けて渡したもの(Buffer の配列)
    if (Array.isArray(data)) {
        const parts = data.map((part) => toData(part) as Uint8Array);
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let offset = 0;
        for (const part of parts) {
            out.set(part, offset);
            offset += part.length;
        }
        return out;
    }
    return String(data);
}

function textOf(data: unknown): string {
    const value = toData(data);
    return typeof value === "string" ? value : new TextDecoder().decode(value);
}

// 利用者のハンドラーを呼ぶ。投げたもの(reject したもの)は onError に回し、onError も投げたらログに出す
// (Node の ws では、イベントの中で投げるとプロセスごと落ちるので、ここで必ず受け止める)
type Emitter = {
    open(): void;
    message(data: WebSocketData): void;
    close(code: number, reason: string): void;
    error(error: unknown): void;
};

function emitter(events: WebSocketEvents, ws: WSConnection): Emitter {
    const report = (error: unknown, fromOnError = false) => {
        if (!fromOnError && events.onError) return run(() => events.onError!(error, ws), true);
        console.error("[senri] A WebSocket handler threw:", error);
    };
    const run = (fn: () => unknown, inOnError = false) => {
        try {
            const result = fn();
            if (result instanceof Promise) result.catch((error) => report(error, inOnError));
        } catch (error) {
            report(error, inOnError);
        }
    };
    return {
        open: () => events.onOpen && run(() => events.onOpen!(ws)),
        message: (data: WebSocketData) => events.onMessage && run(() => events.onMessage!(data, ws)),
        close: (code: number, reason: string) => events.onClose && run(() => events.onClose!(code, reason, ws)),
        error: (error: unknown) => report(error),
    };
}

// Deno と Workers の WebSocket(ブラウザと同じ形)
type StandardSocket = {
    readyState: number;
    binaryType: string;
    send(data: string | ArrayBuffer | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: (event: any) => void): void;
};

function attachStandard(events: WebSocketEvents, socket: StandardSocket, openNow: boolean): void {
    socket.binaryType = "arraybuffer";
    const emit = emitter(
        events,
        wrap(socket, () => socket.readyState),
    );
    socket.addEventListener("message", (event) => emit.message(toData(event.data)));
    socket.addEventListener("close", (event) => {
        // Workers では、クライアントからの close に、サーバー側も close で答える(答えないと、閉じ終わらない)
        if (openNow) {
            try {
                socket.close();
            } catch {
                // もう閉じている
            }
        }
        emit.close(event.code ?? 1005, event.reason ?? "");
    });
    socket.addEventListener("error", (event) => emit.error(event.error ?? event));
    if (openNow) queueMicrotask(emit.open);
    else socket.addEventListener("open", () => emit.open());
}

type Globals = {
    Deno?: { upgradeWebSocket(req: Request): { socket: StandardSocket; response: Response } };
    WebSocketPair?: new () => { 0: StandardSocket & { accept(): void }; 1: StandardSocket & { accept(): void } };
};

/**
 * A handler that upgrades the request to a WebSocket connection, with the event handlers that `create` returns.
 * `create` runs once per connection, before the upgrade, with the request's context.
 *
 * Before upgrading, it answers (by throwing an `HttpError`):
 * - 426 when the request is not a WebSocket upgrade (no `Upgrade: websocket`)
 * - 403 when a browser connects from a page on another origin that `origin` does not allow
 * - 501 on runtimes without WebSocket support here (browsers)
 *
 * Middleware runs as for any request, so authentication can reject the connection before it opens.
 * See the module documentation for what each runtime needs (Node.js needs the `ws` package).
 * Throws a `TypeError` if an `origin` string is not like `"https://example.com"`.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { upgradeWebSocket } from "@senrijs/senri/websocket";
 *
 * const app = createApp();
 * app.get(
 *     "/chat",
 *     upgradeWebSocket(
 *         (c) => ({
 *             onOpen(ws) {
 *                 ws.send(`hello ${c.query("name") ?? "guest"}`);
 *             },
 *             onMessage(data, ws) {
 *                 ws.send(data);
 *             },
 *             onClose(code, reason) {
 *                 console.log("closed", code, reason);
 *             },
 *         }),
 *         { origin: ["https://app.example.com"] },
 *     ),
 * );
 * ```
 */
export function upgradeWebSocket<V extends object = any>(
    create: (c: Context<V>) => WebSocketEvents | Promise<WebSocketEvents>,
    options: UpgradeWebSocketOptions = {},
): (params: any, c: Context<V>) => Promise<Response> {
    const trusted = originMatcher(options.origin, "websocket_origin", "upgradeWebSocket()");

    return async function upgradeWebSocket(_params, c) {
        if (!/(^|,)\s*websocket\s*(,|$)/i.test(c.req.headers.get("upgrade") ?? "")) {
            throw senriError("websocket_not_upgrade", new HttpError(426, "426 Upgrade Required", { headers: { upgrade: "websocket" } }));
        }
        const origin = c.req.headers.get("origin");
        if (origin !== null && !sameHost(origin, c) && !trusted(origin, c)) {
            throw senriError("websocket_origin_rejected", new HttpError(403, "403 Forbidden"));
        }

        const { req, info } = connectionOf(c);
        const node = (info as { [NODE_UPGRADE]?: NodeUpgradeSlot } | undefined)?.[NODE_UPGRADE];
        if (node) {
            if (!node.server) {
                throw senriError(
                    "websocket_no_server",
                    new Error("WebSocket on Node.js needs the ws package: serve(app, { webSocketServer: new WebSocketServer({ noServer: true }) })"),
                );
            }
            node.pending = await create(c);
            return new Response(null, { headers: { [UPGRADE_MARKER]: "1" } });
        }

        const bun = info as { upgrade?(req: Request, options: { data: unknown }): boolean } | undefined;
        if (typeof bun?.upgrade === "function") {
            const events = await create(c);
            let upgraded: boolean;
            try {
                upgraded = bun.upgrade(req, { data: { [BUN_EVENTS]: { events } } });
            } catch {
                // Bun.serve に websocket を渡していないと、Bun は例外を投げる
                upgraded = false;
            }
            if (!upgraded) {
                throw senriError(
                    "websocket_bun_handler",
                    new Error("Bun could not upgrade the request. With Bun.serve, pass websocket from @senrijs/senri/websocket"),
                );
            }
            // upgrade したあとの Response は、Bun が使わない
            return new Response(null);
        }

        const g = globalThis as Globals;
        if (g.Deno?.upgradeWebSocket) {
            const events = await create(c);
            const { socket, response } = g.Deno.upgradeWebSocket(req);
            attachStandard(events, socket, false);
            return response;
        }
        if (typeof g.WebSocketPair === "function") {
            const events = await create(c);
            const pair = new g.WebSocketPair();
            const client = pair[0];
            const server = pair[1];
            server.accept();
            attachStandard(events, server, true);
            return new Response(null, { status: 101, webSocket: client } as ResponseInit);
        }
        throw senriError("websocket_unsupported", new HttpError(501, "501 Not Implemented"));
    };
}
