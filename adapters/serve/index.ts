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
import * as runtime from "../../src/runtime.ts";

type App = {
    fetch: (req: Request) => Response | Promise<Response>;
    routeList(): { method: string; path: string }[];
};

/** Options for {@link serve}. */
export type ServeOptions = {
    // 省略すると、環境変数 PORT → DEFAULT_PORT の順に使う。0 なら空いているポートを自動で選ぶ
    /**
     * The port. Without it, the `PORT` environment variable, then {@link DEFAULT_PORT}. `0` picks a free port.
     * An invalid value (here or in `PORT`) throws a `RangeError`.
     */
    port?: number;
    /**
     * The hostname to listen on, passed to `Bun.serve` / `Deno.serve` / `node:http`.
     * Without it, the runtime's default (all network interfaces on Node.js). Also used in {@link Server.url}.
     */
    hostname?: string;   // 省略するとランタイムのデフォルト(外からも繋がる)
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

// よく使われる 3000 や 8080 とぶつかりにくい番号にしている
/** The port used when neither `port` nor the `PORT` environment variable is given. */
export const DEFAULT_PORT = 3927;

// - option: serve(app, { port }) で明示した
// - env: 環境変数 PORT(デプロイ先のサービスが決めることが多い)
// - default: どちらもなかった
/** Where the port came from: the `port` option, the `PORT` environment variable, or {@link DEFAULT_PORT}. */
export type PortSource = "option" | "env" | "default";

function isPort(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n <= 65535;
}

// 使うポートを決める: 明示した port → 環境変数 PORT → DEFAULT_PORT
// 環境変数は runtime.env で読むので、Deno で --allow-env がなければ聞き返さずにデフォルトになる
/**
 * Decides the port: `explicit`, then the `PORT` environment variable, then {@link DEFAULT_PORT}.
 * Throws a `RangeError` if `explicit` or `PORT` is not a port number (0 to 65535).
 *
 * @param env Reads an environment variable. Defaults to the runtime's; on Deno without permission to read `PORT`, it is treated as unset.
 */
export function resolvePort(
    explicit: number | undefined,
    env: (name: string) => string | undefined = runtime.env,
): { port: number; source: PortSource } {
    if (explicit !== undefined) {
        if (!isPort(explicit)) throw new RangeError(`port が正しいポート番号(0〜65535)ではありません: ${explicit}`);
        return { port: explicit, source: "option" };
    }
    const raw = env("PORT")?.trim();
    if (raw) {
        // 黙ってデフォルトで待ち受けると、デプロイ先で「つながらない」原因が分かりにくいので、エラーにする
        const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!isPort(port)) throw new RangeError(`環境変数 PORT が正しいポート番号(0〜65535)ではありません: ${raw}`);
        return { port, source: "env" };
    }
    return { port: DEFAULT_PORT, source: "default" };
}

const SOURCE_NOTE: Record<PortSource, string> = {
    option: "port オプション",
    env: "環境変数 PORT",
    default: "デフォルト。環境変数 PORT で変えられます",
};

// Bun と Deno の、ここで使う部分だけの型
// (このフォルダは Node の型しか入れてないので、自分で書いておく)
type BunLike = {
    serve(options: {
        port: number;
        hostname?: string;
        fetch: App["fetch"];
    }): { port: number; stop(closeActiveConnections?: boolean): Promise<void> | void };
};
type DenoLike = {
    serve(
        options: { port: number; hostname?: string; onListen?: () => void },
        handler: App["fetch"],
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

// 上限つきで待つ。時間内に終われば true
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
    return Promise.race([promise.then(() => true), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Starts the app on Bun (`Bun.serve`), Deno (`Deno.serve`) or Node.js (`@senrijs/senri/node`), detecting the runtime.
 * The port comes from `options.port`, the `PORT` environment variable, or {@link DEFAULT_PORT}.
 * Prints the URL and routes, and shuts down gracefully on SIGTERM / SIGINT (see {@link ServeOptions}).
 * The promise rejects if listening fails (the port is in use, for example).
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
export async function serve(app: App, options: ServeOptions = {}): Promise<Server> {
    const { port, source } = resolvePort(options.port);
    const hostname = options.hostname;
    const g = globalThis as { Bun?: BunLike; Deno?: DenoLike };

    const timeout = options.shutdownTimeout ?? 10_000;
    if (!Number.isFinite(timeout) || timeout < 0) {
        throw new RangeError(`shutdownTimeout には 0 以上のミリ秒を指定してください: ${timeout}`);
    }

    // 実際に待ち受けたポート(port: 0 なら、ランタイムが選んだ番号)と、止め方
    // - drain: 新しい接続を受けるのをやめ、処理中のものが終わったら resolve
    // - force: 残っている接続を切る(drain が時間内に終わらなかったとき)
    let actualPort: number;
    let drain: () => Promise<void>;
    let force: () => void;

    if (g.Bun) {
        const s = g.Bun.serve({ port, hostname, fetch: app.fetch });
        actualPort = s.port;
        drain = async () => s.stop(false);
        force = () => void s.stop(true);
    } else if (g.Deno) {
        // onListen を空にして、Deno が勝手に出す "Listening on ..." を消す(バナーと二重になるので)
        const s = g.Deno.serve({ port, hostname, onListen() {} }, app.fetch);
        actualPort = s.addr.port;
        drain = () => s.shutdown();
        // Deno には、shutdown() のあとに残りの接続を切る方法がない(signal で abort すると Deno の中で例外になる)
        // なので待つのをやめるだけ。シグナルで止めたときは、このあとプロセスごと終わるので接続も切れる
        force = () => {};
    } else {
        // Node のときだけ node:http を読み込む
        const node = await import("../node/index.ts");
        const s = node.serve(app, { port, hostname });
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
            console.log("\n止めています(処理中のリクエストが終わるのを待ちます)…");
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
        showRoutes(app, url, { note: SOURCE_NOTE[source] });
    }
    return { port: actualPort, url, stop };
}
