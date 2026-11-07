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
import { nodeCoreOf, type AppCore, type Resolved } from "../../src/app.ts";
import { compose } from "../../src/compose.ts";
import { lazyContext, plainOf, type Context, type HandlerResult } from "../../src/context.ts";
import { HttpError } from "../../src/errors.ts";
import { isPlainSafe, PlainResponse, type LazyRequest } from "../../src/plain.ts";

type App = {
    // 2つ目の引数には、接続元のアドレスを Deno の info と同じ形で渡す(ダッシュボードの localhost 制限で使う)
    fetch: (req: Request, info?: { remoteAddr: { hostname: string; port: number; transport: "tcp" } }) =>
        | Response
        | Promise<Response>;
};

// Request が解析するので、ここでは文字列のまま渡す(new URL すると2回解析することになる)
function toUrl(req: IncomingMessage): string {
    const protocol = (req.socket as TLSSocket).encrypted ? "https" : "http";
    // HTTP/1.0 などで Host がないこともある
    const host = req.headers.host ?? "localhost";
    // Host は下で URL の文字列につなぐので、区切り文字が入っているとパスやホストが化ける
    // (例: "x/admin#" → http://x/admin#/path となり、パスが /admin になる)
    if (/[\s/?#@\\]/.test(host)) {
        throw new TypeError(`Invalid Host header: ${host}`);
    }
    const target = req.url ?? "/";
    // absolute-form("GET http://host/path HTTP/1.1")ならそのまま使う
    if (/^https?:\/\//i.test(target)) {
        return target;
    }
    // "/" で始まらないもの("@evil.com/x" や "*")は、つなぐとホスト名などに化けるので受け付けない
    // (Node の HTTP パーサーがたいてい先に 400 にするが、念のため)
    if (!target.startsWith("/")) {
        throw new TypeError(`Invalid request target: ${target}`);
    }
    // new URL(target, base) にすると "//admin" が「プロトコル相対 URL」として
    // ホスト名 admin と解釈されてしまうので、文字列でつなぐ
    // Host が "a b" のように不正だと、new Request で TypeError になる
    return `${protocol}://${host}${target}`;
}

function toHeaders(req: IncomingMessage): HeadersInit {
    // Node が配列にするのは Set-Cookie だけ。それ以外は文字列なので、そのまま渡せる(Request がコピーする)
    if (!req.headers["set-cookie"]) return req.headers as Record<string, string>;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const v of value) headers.append(key, v);
        } else {
            headers.set(key, value);
        }
    }
    return headers;
}

// GET / HEAD はボディを持てない(渡すと Request が TypeError を投げる)
// ボディがない(Content-Length も Transfer-Encoding もない)ときは、空のストリームではなく null にする
// (Bun / Deno と同じ。QUERY の「ボディがない」を見分けるのに使う)
function hasBody(req: IncomingMessage): boolean {
    return (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        (req.headers["content-length"] !== undefined || req.headers["transfer-encoding"] !== undefined)
    );
}

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
    return new Request(toUrl(req), {
        method: req.method,
        headers: toHeaders(req),
        body: hasBody(req) ? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>) : undefined,
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

    // 文字列や JSON の本文は1チャンクで終わる。そのときは res.end() で直接書く(速く、Content-Length も付く)
    const reader = response.body.getReader();
    const first = await reader.read();
    if (first.done) {
        res.end();
        return;
    }
    // 次のチャンクを待つと、SSE の最初のイベントが届かなくなるので、ほんの少しだけ様子を見る
    // 1チャンクの本文なら2ティックで終わりが分かる(Node 22 / 24)。間に合わなくても、下で流すだけで壊れない
    let second: Awaited<ReturnType<typeof reader.read>> | undefined;
    const next = reader.read().then(
        (result) => (second = result),
        // 読み取りの失敗は、下の pipeline でも同じように分かる。読み取り待ちを外したときも、ここに来る
        () => {},
    );
    for (let i = 0; i < 4 && !second; i++) await null;
    reader.releaseLock();
    // 外す直前に届いていたチャンクは、ここで受け取る(捨てない)
    await next;
    if (second?.done) {
        res.end(first.value);
        return;
    }
    res.write(first.value);
    if (second) res.write(second.value);

    // 残りは、届いたチャンクから順に流す
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

function connectionInfo(req: IncomingMessage) {
    return {
        remoteAddr: { hostname: req.socket.remoteAddress ?? "", port: req.socket.remotePort ?? 0, transport: "tcp" as const },
    };
}

function writeFailure(res: ServerResponse, err: unknown) {
    // ここで投げ直すと unhandled rejection でプロセスごと落ちるので、必ず握る
    console.error(err);
    if (res.headersSent) {
        res.destroy();
    } else {
        // 本文の最初の読み取りで失敗したときは、失敗したレスポンスのヘッダーが残っている(Content-Type、Set-Cookie など)
        for (const name of res.getHeaderNames()) res.removeHeader(name);
        res.statusCode = 500;
        res.end("500 Internal Server Error");
    }
}

// app.fetch を通す道。開発モードのアプリと、app.fetch を包んだものはこちら
async function serveWithFetch(app: App, req: IncomingMessage, res: ServerResponse) {
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
        await writeResponse(res, await app.fetch(request, connectionInfo(req)));
    } catch (err) {
        // クライアントが途中で切っただけならエラーではない
        if (!controller.signal.aborted) writeFailure(res, err);
    }
}

// c.req を最初に読んだときに、本物の Request を作る
function lazyRequest(req: IncomingMessage, res: ServerResponse, url: string): LazyRequest {
    return {
        method: req.method!,
        url,
        headers: req.headers,
        hasBody: hasBody(req),
        create() {
            const controller = new AbortController();
            // 読む前に切断されていたら、abort 済みの signal にする
            if (res.destroyed && !res.writableFinished) {
                controller.abort();
            } else {
                res.once("close", () => {
                    if (!res.writableFinished) controller.abort();
                });
            }
            try {
                return toRequest(req, controller.signal);
            } catch (cause) {
                // Node が通したのに Request にできないもの。Request を先に作っていたときと同じく 400 にする
                throw new HttpError(400, "400 Bad Request", { cause });
            }
        },
    };
}

// Response を作らずに書く。ヘッダーの扱いは c.text() / c.json() と c.finalize() を通したときと同じにする
function writePlain(res: ServerResponse, plain: PlainResponse) {
    res.statusCode = plain.status;
    const own = plain.own;
    const added = plain.added;
    if (added) {
        // 純正のミドルウェアが足したものに、c.finalize() と同じ規則で c.header() の分を重ねる
        own?.forEach((value, key) => {
            if (key === "set-cookie") return;
            if ((key === "content-type" || key === "location") && added.has(key)) return;
            added.set(key, value);
        });
        for (const cookie of own?.getSetCookie() ?? []) added.append("set-cookie", cookie);
        added.forEach((value, key) => {
            if (key !== "set-cookie") res.setHeader(key, value);
        });
        const cookies = added.getSetCookie();
        if (cookies.length > 0) res.setHeader("set-cookie", cookies);
    } else {
        res.setHeader("content-type", plain.type);
        if (own) {
            own.forEach((value, key) => {
                if (key !== "set-cookie" && key !== "content-type") res.setHeader(key, value);
            });
            const cookies = own.getSetCookie();
            if (cookies.length > 0) res.setHeader("set-cookie", cookies);
        }
    }
    res.end(plain.body);
}

// ハンドラーの戻り値を、Response を見る人がいないときの形にする
function answerOf(c: Context, value: HandlerResult): Response | PlainResponse {
    return plainOf(c, value) ?? c.toResponse(value);
}

async function respondLazily(core: AppCore, c: Context, resolved: Resolved, method: string): Promise<Response | PlainResponse> {
    const fail = (err: unknown) => core.fail(err, c);
    const layers = core.layers(c);
    // ハンドラーを直接呼ぶ。HEAD の本文を捨てる処理と QUERY の確認は core.inner に任せる(c.req を読む)
    const route = resolved.kind === "route" && method !== "HEAD" && resolved.route.method !== "QUERY" ? resolved.route : null;
    if (layers.length > 0) {
        // 純正のミドルウェアだけなら、Response を見る人はいない。利用者のものが1つでもあれば、本物の Response を渡す
        if (!route || !layers.every((layer) => isPlainSafe(layer.mw))) {
            return compose(layers, c, () => core.inner(c, resolved), fail);
        }
        const inner = async () => answerOf(c, await route.handler(c.params, c));
        return compose(layers, c, inner as unknown as () => Promise<Response>, fail);
    }
    try {
        if (route) {
            const handled = route.handler(c.params, c);
            return answerOf(c, handled instanceof Promise ? await handled : handled);
        }
        return await core.inner(c, resolved);
    } catch (err) {
        return fail(err);
    }
}

// Request を作らずに答える道。app.fetch と同じ流れで、c.req を読まれたときだけ Request を作る
async function serveLazily(core: AppCore, req: IncomingMessage, res: ServerResponse) {
    const method = req.method!;
    let url: string;
    try {
        url = toUrl(req);
        // Request を作らないこともあるので、Request なら投げる URL をここで 400 にする
        if (!URL.canParse(url)) throw new TypeError(`Invalid URL: ${url}`);
    } catch {
        res.statusCode = 400;
        res.end("400 Bad Request");
        return;
    }

    const c = lazyContext(lazyRequest(req, res, url), connectionInfo(req));
    try {
        const resolved = core.resolve(c, method);
        if (resolved.kind === "route") {
            c.route = resolved.route.path;
            c.params = resolved.params;
        }
        const answer = await respondLazily(core, c, resolved, method);
        if (answer instanceof PlainResponse) writePlain(res, answer);
        else await writeResponse(res, c.finalize(answer));
    } catch (err) {
        // クライアントが途中で切っただけならエラーではない
        if (!res.destroyed || res.writableFinished) writeFailure(res, err);
    }
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
 * - If `app.fetch` throws, or the response body fails before anything is sent, the error is logged and 500 is returned
 * - A body that ends after one chunk (a string or JSON) is sent with `Content-Length`; other bodies are streamed as chunks arrive
 * - `c.req` is a real `Request`, created the first time it is read, so a handler that does not read it costs less
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
    const core = nodeCoreOf(app);
    const server = createServer((req, res) => {
        if (NOT_IMPLEMENTED.has(req.method ?? "")) {
            res.writeHead(501, { "content-type": "text/plain; charset=utf-8", connection: "close" });
            res.end("501 Not Implemented");
            return;
        }
        return core ? serveLazily(core, req, res) : serveWithFetch(app, req, res);
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
