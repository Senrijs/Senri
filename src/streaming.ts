/**
 * Helpers for sending a response little by little: {@link stream} for bytes, {@link streamText} for text and
 * {@link streamSSE} for Server-Sent Events. They stop when the client disconnects.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { streamSSE } from "@senrijs/senri/streaming";
 *
 * const app = createApp();
 * app.get("/events", (_, c) =>
 *     streamSSE(c, async (s) => {
 *         for (let i = 0; !s.aborted; i++) {
 *             await s.writeSSE({ event: "tick", id: String(i), data: String(i) });
 *             await s.sleep(1000);
 *         }
 *     }),
 * );
 * ```
 *
 * @module
 */
// @senrijs/senri/streaming の入口
// Context のメソッドにしないのは、使わないアプリのバンドルに入れないため
import type { Context } from "./context.ts";
import { senriError } from "./errors.ts";

/** Writes a response little by little. Passed to the function given to {@link stream} and {@link streamText}. */
export type StreamingApi = {
    /** Sends a chunk, and waits while the client is reading more slowly than this writes. After a disconnect it does nothing. */
    write(chunk: string | Uint8Array): Promise<void>;
    /** Sends text followed by a line break. */
    writeln(text: string): Promise<void>;
    /** Sends all of a stream. It stops and cancels the stream if the client disconnects. */
    pipe(readable: ReadableStream<Uint8Array>): Promise<void>;
    /** Waits, or stops waiting as soon as the client disconnects. */
    sleep(ms: number): Promise<void>;
    /** Ends the response. It also ends when the function returns. */
    close(): void;
    /** Registers cleanup to run when the client disconnects. If it already has, it runs right away. */
    onAbort(listener: () => void | Promise<void>): void;
    /** The client has disconnected. */
    readonly aborted: boolean;
    /** The response has ended. */
    readonly closed: boolean;
};

/** One Server-Sent Event, for {@link SSEStreamingApi.writeSSE}. */
export type SSEMessage = {
    /** The data. Line breaks are sent as several `data:` lines, and the client receives them joined by `\n`. */
    data: string;
    /** The event name. It must not have line breaks. */
    event?: string;
    /** The event ID, which the client sends back as `Last-Event-ID` when it reconnects. It must not have line breaks or NUL. */
    id?: string;
    /** How long the client should wait before reconnecting, in milliseconds. */
    retry?: number;
};

/** {@link StreamingApi} with the methods for Server-Sent Events. Passed to the function given to {@link streamSSE}. */
export type SSEStreamingApi = StreamingApi & {
    /** Sends an event. Throws if a field is not valid. */
    writeSSE(message: SSEMessage): Promise<void>;
    /** Sends a comment, which clients ignore. */
    writeComment(text: string): Promise<void>;
};

/** Options for {@link stream} and {@link streamText}. */
export type StreamOptions<A = StreamingApi> = {
    // 途中のエラー。レスポンスはもう始まっているので、500 は返せない
    /**
     * Called when the function throws. The response has already started, so its status cannot change. This can write a last
     * chunk, and then the response ends normally. Without it, the error is logged and the connection is cut, so that a
     * client does not take a partial download for a complete one.
     */
    onError?: (err: unknown, stream: A) => void | Promise<void>;
};

/** Options for {@link streamSSE}. */
export type SSEOptions = StreamOptions<SSEStreamingApi> & {
    /**
     * Sends a comment this often, in milliseconds, to keep idle connections open. Default `5000`; `false` turns it off.
     * Proxies often close a connection that stays quiet for a minute, and `Bun.serve` closes one after about 10 seconds
     * unless `idleTimeout` is raised. No comment is sent while the client is not keeping up.
     */
    heartbeat?: number | false;
};

const encoder = new TextEncoder();

// Bun.serve の既定(idleTimeout 10 秒)では、静かな接続が早いと 8.8 秒で切られる(Bun 1.4.3 で計測)。余裕を持たせる
const DEFAULT_HEARTBEAT = 5000;

function start(c: Context, run: (api: StreamingApi) => void | Promise<void>, onError: ((err: unknown, api: StreamingApi) => void | Promise<void>) | undefined, stopped: () => void): { response: Response; api: StreamingApi; ping: (text: string) => void } {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let aborted = false;
    let closed = false;
    const listeners: (() => void | Promise<void>)[] = [];
    // 読み手を待っている write は、読み手が来たら起こす。sleep は、切断か終わりのときだけ早く起こす
    let writers: (() => void)[] = [];
    let sleepers: (() => void)[] = [];
    const wakeWriters = () => {
        const list = writers;
        writers = [];
        for (const resolve of list) resolve();
    };
    const wake = () => {
        wakeWriters();
        const list = sleepers;
        sleepers = [];
        for (const resolve of list) resolve();
    };
    const notify = (listener: () => void | Promise<void>) => {
        try {
            void Promise.resolve(listener()).catch((err) => console.error(err));
        } catch (err) {
            console.error(err);
        }
    };

    const signal = c.req.signal;
    const abort = () => {
        if (aborted || closed) return;
        aborted = true;
        signal.removeEventListener("abort", abort);
        wake();
        for (const listener of listeners.splice(0)) notify(listener);
        stopped();
    };
    const finish = () => {
        if (closed) return;
        closed = true;
        signal.removeEventListener("abort", abort);
        wake();
        stopped();
        try {
            controller.close();
        } catch {
            // 切断のあとは、もう閉じている
        }
    };
    const readable = new ReadableStream<Uint8Array>({
        start(ctrl) {
            controller = ctrl;
        },
        pull: wakeWriters,
        // Workers では c.req.signal が発火しないことがあるので、こちらでも切断を知る
        cancel: abort,
    });

    const api: StreamingApi = {
        async write(chunk) {
            if (aborted || closed) return;
            controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
            // 読み手が追いつくまで待つ(メモリにためない)
            if ((controller.desiredSize ?? 1) <= 0) await new Promise<void>((resolve) => writers.push(resolve));
        },
        writeln: (text) => api.write(`${text}\n`),
        async pipe(source) {
            const reader = source.getReader();
            const cancel = () => reader.cancel().catch(() => {});
            listeners.push(cancel);
            try {
                while (!aborted && !closed) {
                    const { done, value } = await reader.read();
                    if (done) return;
                    await api.write(value);
                }
                await cancel();
            } finally {
                const at = listeners.indexOf(cancel);
                if (at !== -1) listeners.splice(at, 1);
                reader.releaseLock();
            }
        },
        sleep(ms) {
            if (aborted || closed) return Promise.resolve();
            return new Promise<void>((resolve) => {
                const done = () => {
                    clearTimeout(timer);
                    sleepers = sleepers.filter((sleeper) => sleeper !== done);
                    resolve();
                };
                const timer = setTimeout(done, ms);
                sleepers.push(done);
            });
        },
        close: finish,
        onAbort(listener) {
            if (aborted) notify(listener);
            else listeners.push(listener);
        },
        get aborted() {
            return aborted;
        },
        get closed() {
            return closed;
        },
    };

    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });

    // ハンドラーが Response を返してから動かす
    void Promise.resolve()
        .then(() => run(api))
        .then(finish, async (err) => {
            // 切断のあとのエラーは、誰にも届かない
            if (aborted) return;
            if (onError) {
                try {
                    await onError(err, api);
                    finish();
                    return;
                } catch (failed) {
                    err = failed;
                }
            }
            console.error(err);
            closed = true;
            signal.removeEventListener("abort", abort);
            wake();
            stopped();
            // 接続を切る。正常に閉じると、途中までのダウンロードが完了に見える
            controller.error(err);
        });

    return {
        response: c.toResponse(readable),
        api,
        // 読み手が止まっているときは送らない(止まった接続に、たまり続けないように)
        ping(text) {
            if (!aborted && !closed && (controller.desiredSize ?? 1) > 0) controller.enqueue(encoder.encode(text));
        },
    };
}

function setDefault(res: Response, name: string, value: string): void {
    if (!res.headers.has(name)) res.headers.set(name, value);
}

/**
 * Sends bytes little by little. Return the result from the handler. The `Content-Type` is `application/octet-stream`
 * unless you set one with `c.header()`, and the status comes from `c.status()`.
 *
 * - **Disconnects:** `s.aborted` becomes `true`, and functions given to `s.onAbort` run. `s.write` then does nothing, so
 *   long loops should check `s.aborted`
 * - **Errors:** the response has already started, so 500 is not possible. See `onError` in {@link StreamOptions}
 * - **On Node.js**, the headers are sent with the first chunk. Write something soon if the client is waiting for them
 * - **On Cloudflare Workers** (checked on workerd), `onAbort` did not run when the client disconnected, with or without
 *   `enable_request_signal` and `waitUntil`, so do not rely on it there to release anything. An error without `onError`
 *   also ends the response as if it were complete, since the runtime finishes it
 * - `compress()` and `etag()` wait up to 5 ms to read the start of the body. A stream that sends a lot at once can be compressed, which holds its data back
 *
 * @param c The context.
 * @param run Writes the response. The response ends when it returns.
 * @param options `onError`: called when `run` throws.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { stream } from "@senrijs/senri/streaming";
 *
 * const app = createApp();
 * app.get("/download", (_, c) => {
 *     c.header("content-type", "application/zip");
 *     return stream(c, async (s) => {
 *         s.onAbort(() => console.log("The client left"));
 *         await s.pipe(makeZipStream());
 *     });
 * });
 * ```
 */
export function stream(c: Context, run: (stream: StreamingApi) => void | Promise<void>, options: StreamOptions = {}): Response {
    const { response } = start(c, run, options.onError, () => {});
    setDefault(response, "content-type", "application/octet-stream");
    return response;
}

/**
 * Sends text little by little, as `text/plain; charset=utf-8` unless you set a type with `c.header()`. It works as
 * {@link stream} does, and adds two headers so that nothing holds the text back: `X-Content-Type-Options: nosniff`
 * for browsers, and `Cache-Control: no-transform` for `compress()` and proxies.
 *
 * @param c The context.
 * @param run Writes the response. The response ends when it returns.
 * @param options `onError`: called when `run` throws.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { streamText } from "@senrijs/senri/streaming";
 *
 * const app = createApp();
 * app.get("/story", (_, c) =>
 *     streamText(c, async (s) => {
 *         await s.writeln("Once upon a time");
 *         await s.sleep(1000);
 *         await s.writeln("The end");
 *     }),
 * );
 * ```
 */
export function streamText(c: Context, run: (stream: StreamingApi) => void | Promise<void>, options: StreamOptions = {}): Response {
    const { response } = start(c, run, options.onError, () => {});
    setDefault(response, "content-type", "text/plain; charset=utf-8");
    setDefault(response, "x-content-type-options", "nosniff");
    setDefault(response, "cache-control", "no-transform");
    return response;
}

function sseText(message: SSEMessage): string {
    const { data, event, id, retry } = message;
    // 改行があると、別のフィールドやイベントを注入できる
    if (typeof data !== "string" || (event !== undefined && /[\r\n]/.test(event)) || (id !== undefined && /[\r\n\0]/.test(id)) || (retry !== undefined && (!Number.isInteger(retry) || retry < 0))) {
        throw senriError("sse_message", "writeSSE(): invalid message");
    }
    let text = "";
    if (event !== undefined) text += `event: ${event}\n`;
    if (id !== undefined) text += `id: ${id}\n`;
    if (retry !== undefined) text += `retry: ${retry}\n`;
    for (const line of data.split(/\r\n|\r|\n/)) text += `data: ${line}\n`;
    return `${text}\n`;
}

/**
 * Sends Server-Sent Events, which browsers read with `EventSource`. It works as {@link stream} does, and also:
 *
 * - Sends `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, which stops nginx from holding events back. `compress()` leaves it uncompressed
 * - Sends a first comment right away, so the headers reach the client before the first event
 * - Sends a comment every 5 seconds, because proxies and `Bun.serve` close quiet connections. Change it with `heartbeat`, or
 *   turn it off with `heartbeat: false`. Clients ignore comments
 * - When the server stops, open streams keep it waiting. Use a signal or your own flag to end them
 *
 * @param c The context.
 * @param run Writes the events. The response ends when it returns, and browsers then reconnect.
 * @param options `heartbeat`: how often to send a comment, or `false`. `onError`: called when `run` throws.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { streamSSE } from "@senrijs/senri/streaming";
 *
 * const app = createApp();
 * app.get("/events", (_, c) =>
 *     streamSSE(c, async (s) => {
 *         const unsubscribe = subscribe((value) => s.writeSSE({ event: "update", data: JSON.stringify(value) }));
 *         s.onAbort(unsubscribe);
 *         while (!s.aborted) await s.sleep(60_000);
 *     }),
 * );
 * ```
 */
export function streamSSE(c: Context, run: (stream: SSEStreamingApi) => void | Promise<void>, options: SSEOptions = {}): Response {
    const { heartbeat = DEFAULT_HEARTBEAT, onError } = options;
    if (heartbeat !== false && !(typeof heartbeat === "number" && heartbeat > 0 && Number.isFinite(heartbeat))) {
        throw senriError("sse_heartbeat", "streamSSE(): invalid heartbeat");
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const withSSE = (api: StreamingApi): SSEStreamingApi =>
        Object.assign(Object.create(api) as StreamingApi, {
            writeSSE: (message: SSEMessage) => api.write(sseText(message)),
            writeComment: (text: string) => api.write(text.split(/\r\n|\r|\n/).map((line) => `: ${line}\n`).join("") + "\n"),
        });
    const { response, api, ping } = start(
        c,
        (base) => run(withSSE(base)),
        onError && ((err, base) => onError(err, withSSE(base))),
        () => clearInterval(timer),
    );
    response.headers.set("content-type", "text/event-stream; charset=utf-8");
    setDefault(response, "cache-control", "no-cache, no-transform");
    setDefault(response, "x-accel-buffering", "no");
    if (!api.aborted) {
        void api.write(": connected\n\n");
        if (heartbeat !== false) {
            timer = setInterval(() => ping(": ping\n\n"), heartbeat);
            // Node で、プロセスの終了を止めない
            (timer as { unref?: () => void }).unref?.();
        }
    }
    return response;
}
