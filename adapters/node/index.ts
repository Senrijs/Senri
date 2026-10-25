import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type App = {
    fetch: (req: Request) => Response | Promise<Response>;
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
    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    return new Request(toUrl(req), {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
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
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), res);
}

export function serve(app: App, options: { port: number }) {
    const server = createServer(async (req, res) => {
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
            await writeResponse(res, await app.fetch(request));
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

    server.listen(options.port);
    return server;
}
