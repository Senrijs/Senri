/**
 * Starts an app on Bun, Deno or Node.js, detecting the runtime.
 * Picks the port, prints the route list and shuts down gracefully on SIGTERM / SIGINT.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { serve } from "@senrijs/senri/serve";
 *
 * const app = createApp();
 * app.get("/", () => "hi");
 * const server = await serve(app);
 * console.log(server.url);
 * ```
 *
 * @module
 */
import { showRoutes } from "../../src/index.ts";
import { setDraining } from "../../src/health.ts";
import { checkMaxRequestBodySize, countBytes } from "../../src/middleware/body-limit.ts";
import { isLang, terminalLang, type Lang } from "../../src/lang.ts";
import { SERVE_MESSAGES } from "./messages.ts";
import { resolvePort } from "./port.ts";
import { websocket } from "../../src/websocket.ts";
import type { WebSocketServerLike } from "../node/index.ts";

/** What `serve()` takes: an app from `createApp()` (it needs `fetch` and `routeList`). */
export type ServeApp = {
    fetch: (req: Request) => Response | Promise<Response>;
    routeList(): { method: string; path: string }[];
};

/** Options for {@link serve}. */
export type ServeOptions = {
    // 省略すると、環境変数 PORT → 3927(port.ts の DEFAULT_PORT)の順に使う。0 なら空いているポートを自動で選ぶ
    /**
     * The port. Without it, the `PORT` environment variable, then 3927. `0` picks a free port.
     * An invalid value (here or in `PORT`) throws a `RangeError`.
     */
    port?: number;
    /**
     * The hostname to listen on, passed to `Bun.serve` / `Deno.serve` / `node:http`.
     * Without it, the runtime's default (all network interfaces on Node.js). Also used in {@link Server.url}.
     */
    hostname?: string;   // 省略するとランタイムのデフォルト(外からも繋がる)
    /**
     * The language of the messages printed to the terminal. Without it, `LC_ALL`, `LC_MESSAGES`, `LANG` and then the OS
     * language decide, and English is used when none of them does. Bun on Windows does not report the OS language.
     */
    lang?: Lang;
    /** Print the URL and the route list on start. Default `true`. */
    banner?: boolean;    // false で起動時のルート一覧を出さない
    // SIGTERM / SIGINT を受けたら、処理中のリクエストを待ってから終わる(既定は true)
    // false なら、シグナルはランタイムの既定どおり(すぐ終わる)
    /**
     * Shut down gracefully on SIGTERM / SIGINT. Default `true`. In order: `health()` readiness turns 503,
     * new connections are refused, in-flight requests are awaited (up to `shutdownTimeout`), `onShutdown` is called,
     * and the process exits. A second signal before in-flight requests finish (or `shutdownTimeout` passes)
     * exits immediately with code 1.
     * With `false`, signals keep the runtime's default behavior.
     */
    gracefulShutdown?: boolean;
    // 処理中のリクエストを待つ上限(ミリ秒)。過ぎたら残りの接続を切って終わる。既定は 10 秒
    /**
     * How long to wait for in-flight requests, in milliseconds. Default `10000`.
     * After that, remaining connections are closed on Bun and Node.js; on Deno, waiting just stops.
     * A negative or non-finite value throws a `RangeError`.
     */
    shutdownTimeout?: number;
    // 待ち受けを止めたあと、終わる前に呼ぶ(DB の接続を閉じる、など)
    /**
     * Called during a signal-triggered shutdown, after in-flight requests have finished or `shutdownTimeout`
     * has passed, and before the process exits (to close a database connection, for example).
     * Not called by {@link Server.stop}.
     */
    onShutdown?: () => unknown;
    // サーバー全体の本文の上限(バイト数)。超えたら 413。省略すると、どのランタイムでも上限なし
    // (0.3.0 で、Bun の既定の 128 MiB をやめた。守りは createApp({ maxBodySize }) の既定 1 MiB と、ルートごとの上限)
    /**
     * A server-wide limit on the request body, in bytes. Over it, the request gets 413 `413 Content Too Large`.
     * Without it there is no server-wide limit, on every runtime (Bun's own 128 MiB default is not used).
     * `Infinity` is the same; a negative or non-numeric value throws a `RangeError`.
     *
     * With `Content-Length`, a body over the limit is refused before it is read. Without it (chunked), it is
     * counted while it is read, and the request gets 413 even if the handler caught the error.
     * The app's default limit for code that reads the whole body is `createApp({ maxBodySize })` (1 MiB); to limit or
     * allow more on a route, use `bodyLimit()`, `uploadLimit()` or the limits of `multipart()`.
     */
    maxRequestBodySize?: number;
    // Node.js で WebSocket を使うときの、ws パッケージの WebSocketServer({ noServer: true })
    /**
     * For WebSocket routes (`upgradeWebSocket()` from `@senrijs/senri/websocket`) on Node.js: a `WebSocketServer` from
     * the `ws` package, created with `noServer: true`. Senri does not read WebSocket frames itself. Set its `maxPayload`
     * (the `ws` default is 100 MiB; development mode warns about it). Ignored on Bun and Deno, which have WebSocket
     * support built in.
     *
     * @example
     * ```ts
     * import { WebSocketServer } from "ws";
     *
     * serve(app, { webSocketServer: new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }) });
     * ```
     */
    webSocketServer?: WebSocketServerLike;
};

/** A server started by {@link serve}. */
export type Server = {
    // 実際に待ち受けているポート(port: 0 のときも、選ばれた番号が入る)
    /** The port actually listened on (the chosen one when `port` is `0`). */
    port: number;
    /** `http://<hostname or "localhost">:<port>`. */
    url: string;
    // 新しい接続を受けるのをやめ、処理中のリクエストが終わるまで(shutdownTimeout まで)待つ。プロセスは終わらない
    /**
     * Stops accepting new connections and waits for in-flight requests (up to `shutdownTimeout`).
     * `health()` readiness turns 503. The process keeps running. Calling it again returns the same promise.
     */
    stop(): Promise<void>;
};

// Bun と Deno の、ここで使う部分だけの型
// (このフォルダは Node の型しか入れてないので、自分で書いておく)
type BunLike = {
    serve(options: {
        port: number;
        hostname?: string;
        maxRequestBodySize?: number;
        fetch: ServeApp["fetch"];
        websocket?: typeof websocket;
    }): { port: number; stop(closeActiveConnections?: boolean): Promise<void> | void };
};
type DenoLike = {
    serve(
        options: { port: number; hostname?: string; onListen?: () => void },
        handler: ServeApp["fetch"],
    ): { addr: { port: number }; shutdown(): Promise<void> };
    addSignalListener(signal: string, handler: () => void): void;
    removeSignalListener(signal: string, handler: () => void): void;
    exit(code?: number): never;
};
type ProcessLike = {
    on(signal: string, handler: () => void): void;
    off(signal: string, handler: () => void): void;
    exit(code?: number): never;
};

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

const tooLarge = () =>
    new Response("413 Content Too Large", {
        status: 413,
        headers: { "content-type": "text/plain; charset=utf-8", connection: "close" },
    });

// Deno 用: 本文が max を超えたら 413 にする(Deno.serve には本文の上限がない)
// Content-Length があれば読む前に決め、ない(チャンク転送)ときは読みながら数える
function limitBody(fetch: ServeApp["fetch"], max: number): ServeApp["fetch"] {
    return async (req, ...rest) => {
        if (req.body === null) return fetch(req, ...rest);
        const length = req.headers.get("content-length");
        if (length !== null) return Number(length) > max ? tooLarge() : fetch(req, ...rest);
        let exceeded = false;
        const body = countBytes(req.body, max, () => (exceeded = true));
        try {
            const res = await fetch(new Request(req, { body, duplex: "half" } as RequestInit), ...rest);
            // ハンドラーがエラーを握りつぶしていても、超えていたら 413 にする
            return exceeded ? tooLarge() : res;
        } catch (err) {
            if (exceeded) return tooLarge();
            throw err;
        }
    };
}

// 上限つきで待つ。時間内に終われば true
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
    return Promise.race([promise.then(() => true), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Starts the app on Bun (`Bun.serve`), Deno (`Deno.serve`) or Node.js (`@senrijs/senri/node`), detecting the runtime.
 * The port comes from `options.port`, the `PORT` environment variable, or 3927.
 * Prints the URL and routes, and shuts down gracefully on SIGTERM / SIGINT (see {@link ServeOptions}).
 * The promise rejects if listening fails (the port is in use, for example), or if `lang` is not `"ja"` or `"en"` (a `TypeError`).
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { serve } from "@senrijs/senri/serve";
 *
 * const app = createApp();
 * app.get("/", () => "hi");
 *
 * const server = await serve(app, {
 *     shutdownTimeout: 30_000,
 *     onShutdown: () => console.log("bye"),
 * });
 * console.log(server.url);
 * ```
 */
export async function serve(app: ServeApp, options: ServeOptions = {}): Promise<Server> {
    if (options.lang !== undefined && !isLang(options.lang)) throw new TypeError('serve(): lang must be "ja" or "en"');
    const messages = SERVE_MESSAGES[options.lang ?? terminalLang()];
    const { port, source } = resolvePort(options.port);
    const hostname = options.hostname;
    const g = globalThis as { Bun?: BunLike; Deno?: DenoLike };

    const timeout = options.shutdownTimeout ?? 10_000;
    if (!Number.isFinite(timeout) || timeout < 0) {
        throw new RangeError(`shutdownTimeout must be a number of milliseconds, 0 or more: ${timeout}`);
    }
    const maxBody = options.maxRequestBodySize;
    checkMaxRequestBodySize(maxBody);

    // 実際に待ち受けたポート(port: 0 なら、ランタイムが選んだ番号)と、止め方
    // - drain: 新しい接続を受けるのをやめ、処理中のものが終わったら resolve
    // - force: 残っている接続を切る(drain が時間内に終わらなかったとき)
    let actualPort: number;
    let drain: () => Promise<void>;
    let force: () => void;

    if (g.Bun) {
        // 省略したときは上限なし(Bun.serve の既定の 128 MiB にしない。Node.js・Deno とそろえる)
        const s = g.Bun.serve({
            port,
            hostname,
            maxRequestBodySize: maxBody ?? Infinity,
            fetch: app.fetch,
            // upgradeWebSocket() のルートのイベントを振り分ける(WebSocket を使わないアプリでも、登録だけしておく)
            websocket,
        });
        actualPort = s.port;
        drain = async () => s.stop(false);
        force = () => void s.stop(true);
    } else if (g.Deno) {
        // onListen を空にして、Deno が勝手に出す "Listening on ..." を消す(バナーと二重になるので)
        const fetch = maxBody === undefined || maxBody === Infinity ? app.fetch : limitBody(app.fetch, maxBody);
        const s = g.Deno.serve({ port, hostname, onListen() {} }, fetch);
        actualPort = s.addr.port;
        drain = () => s.shutdown();
        // Deno には、shutdown() のあとに残りの接続を切る方法がない(signal で abort すると Deno の中で例外になる)
        // なので待つのをやめるだけ。シグナルで止めたときは、このあとプロセスごと終わるので接続も切れる
        force = () => {};
    } else {
        // Node のときだけ node:http を読み込む
        const node = await import("../node/index.ts");
        const s = node.serve(app, { port, hostname, maxRequestBodySize: maxBody, webSocketServer: options.webSocketServer });
        // Node は待ち受けが非同期。使用中のポートなどは error イベントで来るので、ここで reject にする
        // (受け取らないとプロセスごと落ちる)
        await new Promise<void>((resolve, reject) => {
            s.once("listening", resolve);
            s.once("error", reject);
        });
        const address = s.address();
        actualPort = typeof address === "object" && address ? address.port : port;
        drain = () =>
            new Promise((resolve) => {
                s.close(() => resolve());
                // close() は、使っていない keep-alive の接続が切れるまで待ってしまうので、それは先に切る
                s.closeIdleConnections();
            });
        force = () => s.closeAllConnections();
    }

    let stopping: Promise<void> | null = null;
    // シグナルのリスナーを外すもの(止めたあとまで残さない)
    const detach: (() => void)[] = [];
    const stop = () => {
        stopping ??= (async () => {
            // まず /readyz を 503 にする(ロードバランサーが、新しいリクエストを送ってこないように)
            setDraining(true);
            if (!(await within(drain(), timeout))) force();
            // シグナルの受け口は、止まり終わってから外す(待っている間の2回目のシグナルで、すぐ終われるように)
            for (const off of detach) off();
        })();
        return stopping;
    };

    // シグナルを受けたら、止めてから終わる。2回目を受けたら待たずに終わる
    if (options.gracefulShutdown ?? true) {
        const proc = (globalThis as { process?: ProcessLike }).process;
        const exit = (code: number) => (g.Deno ? g.Deno.exit(code) : proc?.exit(code));
        const onSignal = () => {
            if (stopping) return exit(1);
            console.log(`\n${messages.stopping}`);
            stop()
                .then(() => options.onShutdown?.())
                .then(
                    () => exit(0),
                    (err) => {
                        console.error(err);
                        exit(1);
                    },
                );
        };
        for (const signal of SIGNALS) {
            try {
                if (g.Deno) {
                    g.Deno.addSignalListener(signal, onSignal);
                    detach.push(() => g.Deno!.removeSignalListener(signal, onSignal));
                } else if (proc) {
                    proc.on(signal, onSignal);
                    detach.push(() => proc.off(signal, onSignal));
                }
            } catch {
                // Windows の Deno は SIGTERM を受けられない(SIGINT だけ使う)
            }
        }
    }

    const url = `http://${hostname ?? "localhost"}:${actualPort}`;
    if (options.banner ?? true) {
        showRoutes(app, url, { note: messages[source] });
    }
    return { port: actualPort, url, stop };
}
