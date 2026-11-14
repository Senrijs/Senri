// Request を作らずに答える道(serveLazily)と、app.fetch を通す道(serveWithFetch)が、同じ応答を返すか(Node 本体、本物の HTTP で)
// app.fetch を包んだものを serve() に渡すと、app.fetch の道を通る
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import net, { type AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { bodyLimit, cors, createApp, health, HttpError, logger, secureHeaders, type App, type Middleware } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";
import { setCookie } from "../../src/cookie.ts";
import { getIp } from "../../src/ip.ts";
import { devtools } from "../../src/dev/index.ts";
import { COMPARE_TIMEOUT, compareBothPaths, rawCases } from "./http.ts";

let upstreamPort = 0;

function addRoutes(app: App<any>) {
    app.get("/", () => "Hello");
    // 純正のミドルウェアが足すものと、c.header() がぶつかるとき
    app.get("/own-acao", (_, c) => {
        c.header("access-control-allow-origin", "https://own.example");
        return "x";
    });
    app.get("/own-xfo", (_, c) => {
        c.header("x-frame-options", "DENY");
        return { a: 1 };
    });
    app.get("/own-type", (_, c) => {
        c.header("content-type", "text/html");
        c.header("x-frame-options", "DENY");
        return "<p/>";
    });
    app.get("/json", () => ({ a: 1 }));
    app.get("/array", () => [1, 2]);
    app.get("/async", async () => "async");
    app.get("/users/:id", ({ id }) => ({ id }));
    app.get("/status", (_, c) => {
        c.status(201).header("x-mark", "1");
        return "created";
    });
    app.get("/status-json", (_, c) => {
        c.status(202);
        return { ok: true };
    });
    app.get("/status-204", (_, c) => {
        c.status(204);
        return "x";
    });
    app.get("/status-99", (_, c) => {
        c.status(99);
        return "x";
    });
    app.get("/type", (_, c) => {
        c.header("content-type", "text/html");
        return "<p/>";
    });
    app.get("/cookies", (_, c) => {
        setCookie(c, "a", "1");
        setCookie(c, "b", "2");
        c.header("x-mark", "1");
        return "ok";
    });
    app.get("/location", (_, c) => {
        c.status(302);
        c.header("location", "/x");
        return "moved";
    });
    app.get("/empty", () => "");
    app.get("/unicode", () => "こんにちは");
    app.get("/text", (_, c) => c.text("t"));
    app.get("/c-json", (_, c) => c.json({ j: 1 }, 203));
    app.get("/html", (_, c) => c.html("<p/>"));
    app.get("/redirect", (_, c) => c.redirect("/x"));
    app.get("/response", () => new Response("r", { status: 203, headers: { "x-r": "1" } }));
    app.get("/not-found", (_, c) => c.notFound());
    app.get("/http-error", () => {
        throw new HttpError(403, "no");
    });
    app.get("/boom", () => {
        throw new Error("boom");
    });
    app.get("/boom-async", async () => {
        throw new Error("boom");
    });
    app.get("/fn", () => (() => 1) as never);
    app.get("/undef", () => undefined as never);
    app.get("/bigint", () => ({ n: 1n }));
    app.get("/date", () => new Date(0) as never);
    app.get("/class", () => new (class A {
        x = 1;
    })());
    app.get("/map", () => new Map([[1, 2]]));
    app.get("/null-proto", () => Object.assign(Object.create(null), { a: 1 }));
    app.get("/tojson", () => ({ toJSON: () => undefined }));
    app.get("/bytes", () => new Uint8Array([1, 2]));
    app.get("/blob", () => new Blob(["b"], { type: "x/y" }));
    app.get("/form", () => new URLSearchParams({ a: "1" }));
    app.get("/url", (_, c) => c.req.url);
    app.get("/method", (_, c) => c.req.method);
    app.get("/path", (_, c) => c.path);
    app.get("/q", (_, c) => c.query());
    app.get("/ip", (_, c) => getIp(c) ?? "null");
    app.get("/headers", (_, c) => c.req.headers.get("x-a") ?? "none");
    app.post("/echo", async (_, c) => `body=${await c.req.text()}`);
    app.post("/body", async (_, c) => ({ body: await c.body() }));
    app.post("/ignore", () => "ignored");
    app.on("QUERY", "/search", async (_, c) => ({ q: await c.body() }));
    app.post("/both", () => "post");
    app.get("/both", () => "get");
    app.get("/copy", (_, c) => ({
        copy: new Request(c.req).method,
        clone: c.req.clone().method,
        real: Object.getPrototypeOf(c.req) === Request.prototype,
        same: c.req === c.req,
    }));
    app.get("/replace", (_, c) => {
        c.req = new Request("http://replaced/x");
        return c.req.url;
    });
    app.get("/fetch", async (_, c) => (await fetch(`http://127.0.0.1:${upstreamPort}/ok`, c.req)).text());
    app.get("/fetch-req", async (_, c) => (await fetch(new Request(`http://127.0.0.1:${upstreamPort}/ok`, c.req))).text());
}

const GET = (path: string, headers = "", method = "GET") => `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${headers}\r\n`;

const REQUESTS: [string, string][] = [
    ...[
        "/", "/json", "/array", "/async", "/users/42", "/status", "/status-json", "/status-204", "/status-99", "/type", "/cookies", "/location",
        "/empty", "/unicode", "/text", "/c-json", "/html", "/redirect", "/response", "/not-found", "/http-error", "/boom", "/boom-async", "/fn",
        "/undef", "/bigint", "/date", "/class", "/map", "/null-proto", "/tojson", "/bytes", "/blob", "/form", "/url", "/method", "/path", "/q?a=1&b=2",
        "/ip", "/copy", "/replace", "/fetch", "/fetch-req", "/missing",
    ].map((p): [string, string] => [`GET ${p}`, GET(p)]),
    ["GET /headers(x-a)", GET("/headers", "X-A: 1\r\nX-A: 2\r\n")],
    ["HEAD /missing", GET("/missing", "", "HEAD")],
    ...["/", "/json", "/cookies", "/location", "/type", "/boom", "/text", "/response", "/redirect", "/missing"].flatMap((p): [string, string][] => [
        [`GET ${p}(許可された Origin)`, GET(p, "Origin: https://ok.example\r\n")],
        [`GET ${p}(許可されない Origin)`, GET(p, "Origin: https://ng.example\r\n")],
    ]),
    ["プリフライト", GET("/", "Origin: https://ok.example\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: x-a\r\n", "OPTIONS")],
    ["/healthz", GET("/healthz")],
    ["/readyz", GET("/readyz")],
    ["上書き: c.header と cors", GET("/own-acao", "Origin: https://ok.example\r\n")],
    ["上書き: c.header と secureHeaders", GET("/own-xfo")],
    ["上書き: Content-Type と secureHeaders", GET("/own-type")],
    ["POST chunked 超過", "POST /echo HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n8\r\nabcdefgh\r\n0\r\n\r\n"],
    ...["/", "/json", "/boom", "/missing", "/status", "/cookies"].map((p): [string, string] => [`HEAD ${p}`, GET(p, "", "HEAD")]),
    ["POST /both", GET("/both", "Content-Length: 0\r\n", "POST")],
    ["DELETE /both(405)", GET("/both", "", "DELETE")],
    ["OPTIONS /both", GET("/both", "", "OPTIONS")],
    ["POST /echo", "POST /echo HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 3\r\n\r\nabc"],
    ["POST /echo(chunked)", "POST /echo HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n"],
    ["POST /body(JSON)", 'POST /body HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: 7\r\n\r\n{"a":1}'],
    ["POST /ignore(読まない本文)", "POST /ignore HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 3\r\n\r\nabc"],
    ["QUERY /search", "QUERY /search HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nx"],
    ["QUERY /search(本文なし)", "QUERY /search HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"],
    ["Host: a b", "GET / HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n"],
    ["Host: x/admin#", "GET / HTTP/1.1\r\nHost: x/admin#\r\nConnection: close\r\n\r\n"],
    ["Host: x:99999", "GET / HTTP/1.1\r\nHost: x:99999\r\nConnection: close\r\n\r\n"],
    ["Host: [", "GET / HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n"],
    // URL.canParse は、前に通った Host と同じなら呼ばない。違う Host の不正なものが、そのあとも 400 になること
    ...["x:65536", "x:abc", "a<b", "a^b", "a%zz", "example.999", "1.2.3.999", "[::1]:3000", "LOCALHOST", "[::1", "x:"].flatMap((host): [string, string][] => [
        ["Host: localhost(前)", GET("/url")],
        [`Host: ${host}`, `GET /url HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`],
        [`Host: ${host}(2 回目)`, `GET /url HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`],
    ]),
    ["absolute-form(不正なポート)", "GET http://localhost:99999/url HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"],
    ["Host なし(HTTP/1.0)", "GET /url HTTP/1.0\r\n\r\n"],
    ["absolute-form", "GET http://localhost/url HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"],
    ["target @evil", "GET @evil.example/url HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"],
    ["TRACE", "TRACE / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"],
    ["ヘッダーの値に高位バイト", "GET /headers HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nX-A: \xE3\x81\x82\r\n\r\n"],
    ...[
        "//users//42/", "/users/%34%32", "/a/../users/1", "/users/./1", "/users/%2e/1", "/users/a%2Fb", "/users/%E0%A4%A", "/users/%E3%81%82", "/users/\xE3\x81\x82",
        "/users/a|b", '/users/a"b', "/users/a<b", "/users/a{b", "/users/a`b", "/users/a^b", "/users/a\\b", "/path?x=1#f", "/path#f", "/users/a%20b", "/users/a+b", "/users/%00",
    ].map((p): [string, string] => [`path ${p}`, GET(p)]),
];

// ヘッダーの順番は HTTP の意味を変えないので、並べ替えてから比べる
function sortHeaders(text: string): string {
    const end = text.indexOf("\r\n\r\n");
    if (end === -1) return text;
    const [status, ...headers] = text.slice(0, end).split("\r\n");
    return [status, ...headers.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))].join("\r\n") + text.slice(end);
}

// 日付や、起動ごとに変わるものをそろえる
const normalize = (text: string) =>
    sortHeaders(text)
        .replace(/^date: .*$/gim, "date: X")
        .replace(/^server-timing: .*$/gim, "server-timing: X")
        .replace(/localhost:\d+/g, "localhost:P")
        .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:P");

function raw(port: number, text: string): Promise<string> {
    return new Promise((resolve) => {
        const socket = net.connect(port, "127.0.0.1", () => socket.write(text, "latin1"));
        let data = "";
        socket.on("data", (chunk) => (data += chunk.toString("latin1")));
        socket.on("close", () => resolve(normalize(data)));
        socket.on("error", () => resolve(`${normalize(data)}[error]`));
    });
}

const servers: Server[] = [];
async function listen(target: Parameters<typeof serve>[0]): Promise<number> {
    const server = serve(target, { port: 0, hostname: "127.0.0.1" });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return (server.address() as AddressInfo).port;
}
// 同じアプリを、2つの道で待ち受ける
async function bothPaths(app: App<any>): Promise<{ lazy: number; viaFetch: number }> {
    return { lazy: await listen(app), viaFetch: await listen({ fetch: (req, info) => app.fetch(req, info) }) };
}

const quiet = { error: console.error, log: console.log, warn: console.warn };
let upstream: Server;

before(async () => {
    console.error = () => {};
    console.log = () => {};
    console.warn = () => {};
    upstream = createServer((req, res) => {
        if (req.url === "/ok") res.end(`upstream ${req.method}`);
    }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => upstream.once("listening", resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;
});

after(() => {
    Object.assign(console, quiet);
    for (const server of servers) {
        server.closeAllConnections();
        server.close();
    }
    upstream.closeAllConnections();
    upstream.close();
});

describe("Request を作らない道と app.fetch の道で、応答が同じ", () => {
    const groups: [string, () => App<any>][] = [
        [
            "onError / notFound を替えたアプリ",
            () => {
                const app = createApp<any>();
                addRoutes(app);
                app.onError((err, c) => c.text(`onError: ${(err as Error).message}`));
                app.notFound((c) => c.text(`notFound: ${c.path}`));
                return app;
            },
        ],
        [
            "既定のアプリ",
            () => {
                const app = createApp<any>();
                addRoutes(app);
                return app;
            },
        ],
        [
            "ミドルウェアのあるアプリ",
            () => {
                const app = createApp<any>();
                app.use(logger({ format: "json" }));
                app.use(secureHeaders());
                app.use(cors({ origin: "*" }));
                app.use(async (c, next) => {
                    const res = await next();
                    c.header("x-after", c.req.method);
                    return res;
                });
                app.use(bodyLimit({ maxSize: 5 }));
                addRoutes(app);
                return app;
            },
        ],
        ...(
            [
                ["secureHeaders", (app) => app.use(secureHeaders())],
                ["cors(*)", (app) => app.use(cors())],
                ["cors(許可リスト)", (app) => app.use(cors({ origin: ["https://ok.example"], credentials: true, exposeHeaders: ["x-mark"] }))],
                ["logger", (app) => app.use(logger({ format: "json" }))],
                ["health", (app) => app.use(health())],
                ["bodyLimit", (app) => app.use(bodyLimit({ maxSize: 5 }))],
                [
                    "全部",
                    (app) => {
                        app.use(health());
                        app.use(logger({ format: "json" }));
                        app.use(secureHeaders());
                        app.use(cors({ origin: ["https://ok.example"] }));
                        app.use(bodyLimit({ maxSize: 5 }));
                    },
                ],
                [
                    "全部 + 利用者のミドルウェア",
                    (app) => {
                        app.use(secureHeaders());
                        app.use(async (c, next) => {
                            const res = await next();
                            c.header("x-seen-status", String(res.status));
                            return res;
                        });
                        app.use(cors({ origin: ["https://ok.example"] }));
                    },
                ],
            ] as [string, (app: App<any>) => void][]
        ).map(([name, install]): [string, () => App<any>] => [
            `純正のミドルウェア: ${name}`,
            () => {
                const app = createApp<any>();
                install(app);
                addRoutes(app);
                return app;
            },
        ]),
        [
            "開発モードのアプリ",
            () => {
                const app = createApp<any>({ dev: devtools({ lang: "ja" }) });
                addRoutes(app);
                return app;
            },
        ],
    ];

    for (const [name, make] of groups) {
        test(`${name}(${REQUESTS.length} 種類)`, { timeout: COMPARE_TIMEOUT }, async (t) => {
            await compareBothPaths(await bothPaths(make()), rawCases(REQUESTS, raw), t.signal);
        });
    }

    test("比べているリクエストの数(減っていないこと)", () => {
        assert.equal(REQUESTS.length, 152);
    });

    test("URL の確かめは、確かめ済みの Host のあとに来た不正な Host も 400 にする(順番どおりに送る)", async () => {
        const app = createApp();
        app.get("/url", (_, c) => c.req.url);
        const port = await listen(app);
        const send = (host: string) => raw(port, `GET /url HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
        for (const host of ["x:65536", "x:abc", "a<b", "example.999", "[::1"]) {
            assert.match(await send("localhost"), /^HTTP\/1\.1 200[\s\S]*http:\/\/localhost\/url$/, `前: ${host}`);
            assert.match(await send(host), /^HTTP\/1\.1 400/, host);
            assert.match(await send(host), /^HTTP\/1\.1 400/, `${host}(2 回目)`);
        }
        assert.match(await send("[::1]:3000"), /^HTTP\/1\.1 200[\s\S]*http:\/\/\[::1\]:3000\/url$/);
        assert.match(await send("localhost"), /^HTTP\/1\.1 200/);
    });

    test("読まれない本文のあとも、同じ接続で次のリクエストが通る", async () => {
        const app = createApp();
        app.post("/ignore", () => "ignored");
        app.get("/", () => "Hello");
        const port = await listen(app);
        const socket = net.connect(port, "127.0.0.1");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const answer = await new Promise<string>((resolve) => {
            let data = "";
            socket.on("data", (chunk) => {
                data += chunk.toString("latin1");
                if (data.includes("ignored") && data.includes("Hello")) resolve(data);
            });
            socket.write("POST /ignore HTTP/1.1\r\nHost: localhost\r\nContent-Length: 3\r\n\r\nabcGET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
            // 届かなかったときだけ効く(テスト全体の時間切れより先に、届いた分を出す)
            timer = setTimeout(() => resolve(`${data}[timeout]`), 4000);
        });
        clearTimeout(timer);
        socket.destroy();

        assert.ok(!answer.endsWith("[timeout]"), answer);
    });
});

describe("c.req は、読んだときに作られる本物の Request", () => {
    // このテストの間だけ、作られた回数を数える
    function counting(run: (counts: { Request: number; Response: number }) => Promise<void>) {
        return async () => {
            const counts = { Request: 0, Response: 0 };
            const real = { Request: globalThis.Request, Response: globalThis.Response };
            for (const name of ["Request", "Response"] as const) {
                globalThis[name] = new Proxy(real[name] as any, {
                    construct(target, args, newTarget) {
                        counts[name]++;
                        return Reflect.construct(target, args, newTarget);
                    },
                });
            }
            try {
                await run(counts);
            } finally {
                Object.assign(globalThis, real);
            }
        };
    }

    test(
        "読まないハンドラーでは作らない。読むと1回だけ作る",
        counting(async (counts) => {
            const app = createApp();
            app.get("/none", () => "Hello");
            app.get("/params/:id", ({ id }) => id);
            app.get("/path", (_, c) => c.path);
            app.get("/ip", (_, c) => getIp(c) ?? "null");
            app.get("/read", (_, c) => `${c.req.method} ${c.req.url === c.req.url} ${c.req === c.req}`);
            const port = await listen(app);

            for (const path of ["/none", "/params/1", "/path", "/ip", "/missing"]) {
                counts.Request = 0;
                await raw(port, GET(path));
                assert.equal(counts.Request, 0, path);
            }
            counts.Request = 0;
            await raw(port, GET("/read"));
            assert.equal(counts.Request, 1);
        }),
    );

    test(
        "文字列と素のオブジェクトを返すハンドラーでは、Response を作らない。ほかは今までどおり本物を使う",
        counting(async (counts) => {
            const app = createApp();
            app.get("/text", () => "Hello");
            app.get("/json", () => ({ a: 1 }));
            app.get("/array", () => [1]);
            app.get("/async", async () => "Hello");
            app.get("/headers", (_, c) => {
                c.status(201).header("x-mark", "1");
                return "Hello";
            });
            app.get("/c-text", (_, c) => c.text("Hello"));
            app.get("/c-json", (_, c) => c.json({ a: 1 }));
            app.get("/response", () => new Response("Hello"));
            app.get("/bytes", () => new Uint8Array([1]));
            app.get("/class", () => new (class A {
                x = 1;
            })());
            app.get("/status-204", (_, c) => {
                c.status(204);
                return "Hello";
            });
            const port = await listen(app);

            // 既定の 404 も、Response を作らずに返す(app.notFound() で差し替えたときは、下で確かめる)
            for (const path of ["/text", "/json", "/array", "/async", "/headers", "/missing"]) {
                counts.Response = 0;
                await raw(port, GET(path));
                assert.equal(counts.Response, 0, path);
            }
            for (const path of ["/c-text", "/c-json", "/response", "/bytes", "/class"]) {
                counts.Response = 0;
                await raw(port, GET(path));
                assert.equal(counts.Response, 1, path);
            }
            // HEAD とミドルウェアのあるルートは、今までの道を通る
            counts.Response = 0;
            await raw(port, GET("/text", "", "HEAD"));
            assert.ok(counts.Response >= 1, "HEAD");

            const withMiddleware = createApp();
            withMiddleware.use((_c, next) => next());
            withMiddleware.get("/", () => "Hello");
            const middlewarePort = await listen(withMiddleware);
            counts.Response = 0;
            counts.Request = 0;
            await raw(middlewarePort, GET("/"));
            assert.equal(counts.Response, 1, "ミドルウェア");
            // HEAD かどうかを確かめるためだけに、Request は作らない
            assert.equal(counts.Request, 0, "ミドルウェア: Request");
            counts.Request = 0;
            const head = await raw(middlewarePort, GET("/", "", "HEAD"));
            assert.match(head, /^HTTP\/1\.1 200/);
            assert.ok(head.endsWith("\r\n\r\n"), "HEAD は本文を送らない");
            assert.equal(counts.Request, 0, "ミドルウェア + HEAD: Request");

            // app.notFound() で差し替えた 404 は、今までどおり本物の Response を通る
            const custom = createApp();
            custom.notFound((c) => c.text("nope", 404));
            const customPort = await listen(custom);
            counts.Response = 0;
            assert.match(await raw(customPort, GET("/missing")), /^HTTP\/1\.1 404[\s\S]*nope$/);
            assert.equal(counts.Response, 1, "app.notFound()");
        }),
    );

    test(
        "純正のミドルウェアだけなら、Request も Response も作らない",
        counting(async (counts) => {
            const app = createApp();
            app.use(health());
            app.use(logger({ format: "json" }));
            app.use(secureHeaders());
            app.use(cors());
            app.use(bodyLimit({ maxSize: 5 }));
            app.get("/", () => "Hello");
            app.get("/json", () => ({ a: 1 }));
            const port = await listen(app);

            for (const path of ["/", "/json"]) {
                counts.Request = 0;
                counts.Response = 0;
                assert.match(await raw(port, GET(path, "Origin: https://ok.example\r\n")), /^HTTP\/1\.1 200/, path);
                assert.equal(counts.Request, 0, `${path} Request`);
                assert.equal(counts.Response, 0, `${path} Response`);
            }
        }),
    );

    test(
        "利用者のミドルウェアが混ざると、本物の Response を作る",
        counting(async (counts) => {
            const app = createApp();
            app.use(secureHeaders());
            app.use((_c, next) => next());
            app.use(cors());
            app.get("/", () => "Hello");
            const port = await listen(app);

            counts.Response = 0;
            await raw(port, GET("/"));
            assert.ok(counts.Response >= 1);
        }),
    );

    test("利用者のミドルウェアに渡るのは、いつも本物の Response", async () => {
        const seen: [string, boolean][] = [];
        const look =
            (name: string): Middleware =>
            async (_c, next) => {
                const res = await next();
                seen.push([name, Object.getPrototypeOf(res) === Response.prototype]);
                return res;
            };
        const app = createApp();
        app.use(look("外側"));
        app.use(secureHeaders());
        app.use(cors());
        app.use(look("内側"));
        app.get("/", () => "Hello");
        app.get("/json", () => ({ a: 1 }));
        const port = await listen(app);

        await raw(port, GET("/"));
        await raw(port, GET("/json"));

        assert.deepEqual(seen, [
            ["内側", true],
            ["外側", true],
            ["内側", true],
            ["外側", true],
        ]);
    });

    test("純正のミドルウェアを包むと、利用者のミドルウェアとして扱う", async () => {
        let real = false;
        const inner = secureHeaders();
        const app = createApp();
        app.use(async (c, next) => {
            const res = await inner(c, next);
            real = Object.getPrototypeOf(res) === Response.prototype;
            return res;
        });
        app.get("/", () => "Hello");
        const text = await raw(await listen(app), GET("/"));

        assert.equal(real, true);
        assert.match(text, /^x-frame-options: SAMEORIGIN$/im);
    });

    test("cors の origin の関数は、本物の c.req を読める", async () => {
        let proto: unknown;
        const app = createApp();
        app.use(
            cors({
                origin: (origin, c) => {
                    proto = Object.getPrototypeOf(c.req);
                    return origin;
                },
            }),
        );
        app.get("/", () => "Hello");
        const text = await raw(await listen(app), GET("/", "Origin: https://a.example\r\n"));

        assert.equal(proto, Request.prototype);
        assert.match(text, /^access-control-allow-origin: https:\/\/a\.example$/im);
    });

    test("logger は、Response を作らない道でも status と URL を記録する", async () => {
        const lines: string[] = [];
        const original = console.log;
        console.log = (line: unknown) => void lines.push(String(line));
        try {
            const app = createApp();
            app.use(logger({ format: "json" }));
            app.get("/created", (_, c) => {
                c.status(201);
                return "x";
            });
            await raw(await listen(app), GET("/created?a=1"));
        } finally {
            console.log = original;
        }
        const entry = JSON.parse(lines.at(-1)!);

        assert.equal(entry.req.method, "GET");
        assert.equal(entry.req.url, "/created");
        assert.equal(entry.res.statusCode, 201);
    });

    test("本物の Request で、Request のサブクラスではない", async () => {
        let proto: unknown;
        let brand = false;
        const app = createApp();
        app.get("/", (_, c) => {
            proto = Object.getPrototypeOf(c.req);
            // Web 標準の処理に渡せる
            brand = new Request(c.req).url === c.req.url;
            return "ok";
        });
        await raw(await listen(app), GET("/"));

        assert.equal(proto, Request.prototype);
        assert.equal(brand, true);
    });

    test("開発モードのアプリは、今までどおり先に作る", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        let real = false;
        app.get("/", (_, c) => {
            real = Object.getPrototypeOf(c.req) === Request.prototype;
            return "ok";
        });
        await raw(await listen(app), GET("/"));

        assert.equal(real, true);
    });

    test("c.req への代入(読む前でも、読んだあとでも)", async () => {
        const app = createApp();
        app.get("/before", (_, c) => {
            c.req = new Request("http://replaced/before");
            return c.req.url;
        });
        app.get("/after", (_, c) => {
            void c.req.url;
            c.req = new Request("http://replaced/after");
            return c.req.url;
        });
        const port = await listen(app);

        assert.match(await raw(port, GET("/before")), /http:\/\/replaced\/before$/);
        assert.match(await raw(port, GET("/after")), /http:\/\/replaced\/after$/);
    });

    test("bodyLimit が差し替えたあとも、本文を読める", async () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 5 }));
        app.post("/", async (_, c) => c.req.text());
        const port = await listen(app);

        assert.match(await raw(port, "POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n"), /abc/);
        assert.match(await raw(port, "POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n8\r\nabcdefgh\r\n0\r\n\r\n"), /^HTTP\/1\.1 413/);
    });
});

describe("切断の abort(Request を作らない道でも)", () => {
    // 時間で待ってから切ると、遅いマシンではハンドラーに届く前に切れてしまう。なので、届いたことを確かめてから切る
    const send = (port: number, path: string) => net.connect(port, "127.0.0.1", function (this: net.Socket) {
        this.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    });
    // 外から resolve できる Promise
    function signalled<T = void>() {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((r) => (resolve = r));
        return { promise, resolve };
    }
    // 届かなかったときに、テスト全体の時間切れより先に、何が届かなかったかを出す(失敗したときだけ効く)
    async function within<T>(promise: Promise<T>, label: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} が届かなかった`)), 4000);
        });
        try {
            return await Promise.race([promise, late]);
        } finally {
            clearTimeout(timer);
        }
    }

    test("c.req.signal", async () => {
        const app = createApp();
        const entered = signalled();
        const aborted = signalled();
        app.get("/", (_, c) => {
            c.req.signal.addEventListener("abort", () => aborted.resolve());
            entered.resolve();
            return new Promise<Response>(() => {});
        });
        const socket = send(await listen(app), "/");
        await within(entered.promise, "リクエスト");
        socket.destroy();

        await within(aborted.promise, "abort");
    });

    test("切断のあとで初めて c.req を読んでも、signal は abort 済み", async () => {
        const app = createApp();
        const entered = signalled();
        const closed = signalled();
        const seen = signalled<boolean>();
        app.get("/", async (_, c) => {
            entered.resolve();
            // サーバーが切断を受け取るまで、c.req を読まずに待つ
            await closed.promise;
            seen.resolve(c.req.signal.aborted);
            return "x";
        });
        const port = await listen(app);
        // サーバー側の接続が閉じたら知らせる(同じ 'close' で、Node は応答も閉じる。続きはそのあとのマイクロタスクで動く)
        servers.at(-1)!.once("connection", (socket) => socket.once("close", () => closed.resolve()));
        const socket = send(port, "/");
        await within(entered.promise, "リクエスト");
        socket.destroy();

        assert.equal(await within(seen.promise, "signal"), true);
    });

    test("new Request(c.req) と c.req.clone()", async () => {
        const app = createApp();
        const events: string[] = [];
        const entered = signalled();
        const both = signalled();
        const mark = (name: string) => () => {
            events.push(name);
            if (events.length === 2) both.resolve();
        };
        app.get("/", (_, c) => {
            new Request(c.req).signal.addEventListener("abort", mark("copy"));
            c.req.clone().signal.addEventListener("abort", mark("clone"));
            entered.resolve();
            return new Promise<Response>(() => {});
        });
        const socket = send(await listen(app), "/");
        await within(entered.promise, "リクエスト");
        socket.destroy();

        await within(both.promise, "abort");
        assert.deepEqual(events.sort(), ["clone", "copy"]);
    });

    test("fetch(c.req) の相手への接続も切れる", async () => {
        const reached = signalled();
        const upstreamClosed = signalled();
        const hanging = createServer((req) => {
            req.socket.once("close", () => upstreamClosed.resolve());
            reached.resolve();
        }).listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => hanging.once("listening", resolve));
        const hangingPort = (hanging.address() as AddressInfo).port;
        try {
            const app = createApp();
            app.get("/", async (_, c) => (await fetch(new Request(`http://127.0.0.1:${hangingPort}/`, c.req)).catch(() => new Response("x"))));
            const socket = send(await listen(app), "/");
            // 上流にリクエストが届いてから切る
            await within(reached.promise, "上流へのリクエスト");
            socket.destroy();

            await within(upstreamClosed.promise, "上流の切断");
        } finally {
            hanging.closeAllConnections();
            hanging.close();
        }
    });

    test("応答を返したあとに読んだ signal は abort されていない", async () => {
        const app = createApp();
        let read = () => true;
        app.get("/", (_, c) => {
            read = () => c.req.signal.aborted;
            return "x";
        });
        const port = await listen(app);
        const closed = signalled();
        servers.at(-1)!.once("connection", (socket) => socket.once("close", () => closed.resolve()));
        // 応答を受け取り、サーバー側の接続も閉じてから初めて c.req を読む
        await raw(port, GET("/"));
        await within(closed.promise, "サーバー側の切断");

        assert.equal(read(), false);
    });
});
