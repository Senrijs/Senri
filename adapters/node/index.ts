import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { Readable } from "node:stream";

type App = {
    fetch: (req: Request) => Response | Promise<Response>;
};

function toUrl(req: IncomingMessage): URL {
    const protocol = (req.socket as TLSSocket).encrypted ? "https" : "http";
    // HTTP/1.0 などで Host がないこともある
    const host = req.headers.host ?? "localhost";
    // req.url が "/path" でも "http://host/path"(absolute-form)でも組み立てられる
    // Host が "a b" のように不正だとここで TypeError になる
    return new URL(req.url ?? "/", `${protocol}://${host}`);
}

function toRequest(req: IncomingMessage): Request {
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
    res.end(Buffer.from(await response.arrayBuffer()));
}

export function serve(app: App, options: { port: number }) {
    const server = createServer(async (req, res) => {
        let request: Request;
        try {
            request = toRequest(req);
        } catch {
            res.statusCode = 400;
            res.end("400 Bad Request");
            return;
        }

        try {
            await writeResponse(res, await app.fetch(request));
        } catch (err) {
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
