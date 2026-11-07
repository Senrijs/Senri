// NODE_ENV が development / test でないとき、devtools() が localhost へのリクエストだけに開発用の出力をするか(Node 本体で、本物の HTTP で)
// Node のアダプターは request.url を Host ヘッダーから作るので、127.0.0.1 に Host: example.com を送ると、URL は example.com になる
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp, type App } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { serve } from "../../adapters/node/index.ts";

type Reply = { status: number; type: string; timing: string | undefined; body: string };

function get(port: number, host: string, path: string, accept = "*/*"): Promise<Reply> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, headers: { host, accept } }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () =>
                resolve({
                    status: res.statusCode ?? 0,
                    type: String(res.headers["content-type"] ?? ""),
                    timing: res.headers["server-timing"] as string | undefined,
                    body,
                }),
            );
        });
        req.on("error", reject);
        req.end();
    });
}

// NODE_ENV を入れてから devtools() を呼び、アプリを起動する(devtools() は呼んだときに NODE_ENV を読む)
async function start(nodeEnv: string | undefined, setup?: (app: App) => void): Promise<{ server: Server; port: number }> {
    const original = process.env.NODE_ENV;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    const app = (() => {
        try {
            return createApp({ dev: devtools({ lang: "ja" }) });
        } finally {
            if (original === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = original;
        }
    })();
    app.get("/hello", () => "hi");
    app.get("/boom", () => {
        throw new Error("secret detail");
    });
    setup?.(app);
    const server = serve(app, { port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return { server, port: (server.address() as AddressInfo).port };
}

async function devOutput(port: number, host: string) {
    const error = await get(port, host, "/boom");
    const page = await get(port, host, "/boom", "text/html");
    const notFound = await get(port, host, "/helo");
    const ok = await get(port, host, "/hello");
    return {
        errorBody: error.body.includes("secret detail"),
        errorPage: page.type.includes("text/html"),
        routeList: notFound.body.includes("もしかして"),
        serverTiming: ok.timing !== undefined,
    };
}
const ALL = { errorBody: true, errorPage: true, routeList: true, serverTiming: true };
const NONE = { errorBody: false, errorPage: false, routeList: false, serverTiming: false };

describe("devtools(): NODE_ENV が未設定(Node)", () => {
    let server: Server;
    let port: number;
    const warn = console.warn;
    before(async () => {
        console.warn = () => {};
        ({ server, port } = await start(undefined));
    });
    after(() => {
        console.warn = warn;
        server.close();
    });

    test("Host: example.com には、開発用の出力をしない", async () => {
        assert.deepEqual(await devOutput(port, "example.com"), NONE);
    });

    test("Host: localhost(接続元も loopback)には、開発用の出力をする", async () => {
        assert.deepEqual(await devOutput(port, `localhost:${port}`), ALL);
    });
});

describe("devtools(): NODE_ENV=development(Node)", () => {
    let server: Server;
    let port: number;
    before(async () => {
        ({ server, port } = await start("development"));
    });
    after(() => server.close());

    test("Host: example.com にも、開発用の出力をする", async () => {
        assert.deepEqual(await devOutput(port, "example.com"), ALL);
    });
});

describe("ルートとミドルウェアの書き間違いの警告(Node)", () => {
    test("実際のリクエストで、1回だけ出す", async () => {
        const warn = console.warn;
        const lines: string[] = [];
        console.warn = (...args: unknown[]) => void lines.push(String(args[0]));
        const { server, port } = await start("development", (app) => app.use("/helo", (_c, next) => next()));
        try {
            await get(port, `localhost:${port}`, "/hello");
            await get(port, `localhost:${port}`, "/hello");

            assert.equal(lines.length, 1);
            assert.match(lines[0]!, /^\[senri\] "\/helo" のミドルウェア\(anonymous#1\)は、どのルートにも当たりません。"\/hello" の打ち間違いではありませんか/);
        } finally {
            console.warn = warn;
            server.close();
        }
    });
});

// デコードできないパスでミドルウェアが c.notFound() を呼んだとき、本番と開発モードで同じ固定の 404 になる
for (const nodeEnv of ["production", "development"]) {
    describe(`デコードできないパスの c.notFound(): NODE_ENV=${nodeEnv}(Node)`, () => {
        let server: Server;
        let port: number;
        before(async () => {
            ({ server, port } = await start(nodeEnv, (app) => app.use((c) => c.notFound())));
        });
        after(() => server.close());

        for (const accept of ["*/*", "text/html"]) {
            test(`Accept: ${accept}`, async () => {
                const res = await get(port, `localhost:${port}`, "/%E0%A4%A", accept);

                assert.equal(res.status, 404);
                assert.equal(res.type, "text/plain; charset=utf-8");
                assert.equal(res.body, "404 Not Found");
            });
        }
    });
}
