/**
 * Node.js adapter: serves an app with `node:http`.
 * To start on any runtime with a port from `PORT` and graceful shutdown, use `@senrijs/senri/serve` instead.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { serve } from "@senrijs/senri/node";
 *
 * const app = createApp();
 * app.get("/", () => "hi");
 * serve(app, { port: 3927 });
 * ```
 *
 * @module
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type App = {
    // 2つ目の引数には、接続元のアドレスを Deno の info と同じ形で渡す(ダッシュボードの localhost 制限で使う)
    fetch: (req: Request, info?: { remoteAddr: { hostname: string; port: number; transport: "tcp" } }) =>
        | Response
        | Promise<Response>;
};

function toUrl(req: IncomingMessage): URL {
    const protocol = (req.socket as TLSSocket).encrypted ? "https" : "http";
    // HTTP/1.0 などで Host がないこともある
    const host = req.headers.host ?? "localhost";
    // Host は下で URL の文字列につなぐので、区切り文字が入っているとパスやホストが化ける
    // (例: "x/admin#" → http://x/admin#/path となり、パスが /admin になる)
    if (/[\s/?#@\\]/.test(host)) {
        throw new TypeError(`不正な Host ヘッダーです: ${host}`);
    }
    const target = req.url ?? "/";
    // absolute-form("GET http://host/path HTTP/1.1")ならそのまま使う
    if (/^https?:\/\//i.test(target)) {
        return new URL(target);
    }
    // "/" で始まらないもの("@evil.com/x" や "*")は、つなぐとホスト名などに化けるので受け付けない
    // (Node の HTTP パーサーがたいてい先に 400 にするが、念のため)
    if (!target.startsWith("/")) {
        throw new TypeError(`不正なリクエストターゲットです: ${target}`);
    }
    // new URL(target, base) にすると "//admin" が「プロトコル相対 URL」として
    // ホスト名 admin と解釈されてしまうので、文字列でつないでから URL にする
    // Host が "a b" のように不正だとここで TypeError になる
    return new URL(`${protocol}://${host}${target}`);
}

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const v of value) headers.append(key, v);
        } else {
            headers.set(key, value);
        }
    }

    // GET / HEAD はボディを持てない(渡すと Request が TypeError を投げる)
    // ボディがない(Content-Length も Transfer-Encoding もない)ときは、空のストリームではなく null にする
    // (Bun / Deno と同じ。QUERY の「ボディがない」を見分けるのに使う)
    const hasBody =
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        (req.headers["content-length"] !== undefined || req.headers["transfer-encoding"] !== undefined);

    return new Request(toUrl(req), {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>) : undefined,
        // ストリームをボディにするときに必要(読みながら送る「半二重」の指定)
        duplex: "half",
        signal,
    } as RequestInit);
}

async function writeResponse(res: ServerResponse, response: Response) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        // set-cookie は1つずつ来るので、setHeader で上書きしないよう下でまとめて入れる
        if (key !== "set-cookie") res.setHeader(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) res.setHeader("set-cookie", cookies);

    if (!response.body) {
        res.end();
        return;
    }
    // 全部ためてから送るのではなく、届いたチャンクから順に流す
    // pipeline は書き込みが詰まったら読むのを待ってくれる(バックプレッシャー)
    await pipeline(Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream), res);
}

// 扱わないメソッド。CONNECT はプロキシ用、TRACE / TRACK はリクエストをそのまま返すので XST 攻撃に使われる
const NOT_IMPLEMENTED = new Set(["CONNECT", "TRACE", "TRACK"]);

function notImplemented(socket: Duplex) {
    const body = "501 Not Implemented";
    socket.end(
        [
            "HTTP/1.1 501 Not Implemented",
            "Content-Type: text/plain; charset=utf-8",
            `Content-Length: ${body.length}`,
            "Connection: close",
            "",
            body,
        ].join("\r\n"),
    );
}

// hostname: 待ち受けるアドレス。省略すると全部のアドレス(node:http の既定)
/**
 * Serves an app with `node:http` on `options.port` and returns the `http.Server`.
 * It listens on `options.hostname`, or on all network interfaces when it is omitted.
 * Listening starts asynchronously; wait for its `listening` event if you need it.
 *
 * - The client address is passed to `app.fetch` (for `getIp` and the dev dashboard)
 * - If the client disconnects before the response is sent, `c.req.signal` is aborted
 * - CONNECT, TRACE, TRACK and methods Node.js does not know get 501; an invalid `Host` or request target gets 400
 * - If `app.fetch` throws, the error is logged and 500 is returned
 *
 * Unlike `serve()` from `@senrijs/senri/serve`, it does not read `PORT`, print routes or handle graceful shutdown.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { serve } from "@senrijs/senri/node";
 *
 * const app = createApp();
 * app.get("/", () => "hi");
 * const server = serve(app, { port: 3927 });
 * server.once("listening", () => console.log("listening"));
 * ```
 */
export function serve(app: App, options: { port: number; hostname?: string | undefined }): Server {
    const server = createServer(async (req, res) => {
        if (NOT_IMPLEMENTED.has(req.method ?? "")) {
            res.writeHead(501, { "content-type": "text/plain; charset=utf-8", connection: "close" });
            res.end("501 Not Implemented");
            return;
        }

        // レスポンスを送り終える前に接続が切れたら、アプリに c.req.signal で知らせる
        const controller = new AbortController();
        res.once("close", () => {
            if (!res.writableFinished) controller.abort();
        });

        let request: Request;
        try {
            request = toRequest(req, controller.signal);
        } catch {
            res.statusCode = 400;
            res.end("400 Bad Request");
            return;
        }

        try {
            const info = {
                remoteAddr: { hostname: req.socket.remoteAddress ?? "", port: req.socket.remotePort ?? 0, transport: "tcp" as const },
            };
            await writeResponse(res, await app.fetch(request, info));
        } catch (err) {
            // クライアントが途中で切っただけならエラーではない
            if (controller.signal.aborted) return;
            // ここで投げ直すと unhandled rejection でプロセスごと落ちるので、必ず握る
            console.error(err);
            if (res.headersSent) {
                res.destroy();
            } else {
                res.statusCode = 500;
                res.end("500 Internal Server Error");
            }
        }
    });

    // CONNECT は request ではなく connect イベントで来る(聞いていないと、何も返さずに切ってしまう)
    server.on("connect", (_req, socket: Duplex) => notImplemented(socket));
    // Node の HTTP パーサーが知らないメソッドは、アプリに届く前にエラーになる。既定の 400 ではなく 501 にする
    server.on("clientError", (err: NodeJS.ErrnoException, socket: Duplex) => {
        if (!socket.writable) return socket.destroy();
        // ほかは Node の既定と同じ status にする(リスナーを付けると、既定の処理は動かなくなる)
        const status =
            err.code === "HPE_INVALID_METHOD"
                ? "501 Not Implemented"
                : err.code === "HPE_HEADER_OVERFLOW"
                  ? "431 Request Header Fields Too Large"
                  : err.code === "HPE_CHUNK_EXTENSIONS_OVERFLOW"
                    ? "413 Payload Too Large"
                    : err.code === "ERR_HTTP_REQUEST_TIMEOUT"
                      ? "408 Request Timeout"
                      : "400 Bad Request";
        if (status.startsWith("501")) return notImplemented(socket);
        socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    });

    server.listen(options.port, options.hostname);
    return server;
}
