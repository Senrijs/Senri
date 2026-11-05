// Request を作らずに答える道(serveLazily)と、app.fetch を通す道(serveWithFetch)が、同じ応答を返すか(Node 本体、本物の HTTP で)
// app.fetch を包んだものを serve() に渡すと、app.fetch の道を通る
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import net, { type AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { bodyLimit, cors, createApp, HttpError, logger, secureHeaders, type App } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";
import { setCookie } from "../../src/cookie.ts";
import { getIp } from "../../src/ip.ts";
import { devtools } from "../../src/dev/index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let upstreamPort = 0;

function addRoutes(app: App<any>) {
    app.get("/", () => "Hello");
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

// 日付や、起動ごとに変わるものをそろえる
const normalize = (text: string) =>
    text
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
        [
            "開発モードのアプリ",
            () => {
                const app = createApp<any>({ dev: devtools() });
                addRoutes(app);
                return app;
            },
        ],
    ];

    for (const [name, make] of groups) {
        test(`${name}(${REQUESTS.length} 種類)`, async () => {
            const { lazy, viaFetch } = await bothPaths(make());
            for (const [label, text] of REQUESTS) {
                assert.equal(await raw(lazy, text), await raw(viaFetch, text), label);
            }
        });
    }

    test("比べているリクエストは 90 種類ある(4グループで 360 件)", () => {
        assert.equal(REQUESTS.length, 90);
    });

    test("読まれない本文のあとも、同じ接続で次のリクエストが通る", async () => {
        const app = createApp();
        app.post("/ignore", () => "ignored");
        app.get("/", () => "Hello");
        const port = await listen(app);
        const socket = net.connect(port, "127.0.0.1");
        const answer = await new Promise<string>((resolve) => {
            let data = "";
            socket.on("data", (chunk) => {
                data += chunk.toString("latin1");
                if (data.includes("ignored") && data.includes("Hello")) resolve(data);
            });
            socket.write("POST /ignore HTTP/1.1\r\nHost: localhost\r\nContent-Length: 3\r\n\r\nabcGET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
            setTimeout(() => resolve(`${data}[timeout]`), 1000);
        });
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

            for (const path of ["/text", "/json", "/array", "/async", "/headers"]) {
                counts.Response = 0;
                await raw(port, GET(path));
                assert.equal(counts.Response, 0, path);
            }
            for (const path of ["/c-text", "/c-json", "/response", "/bytes", "/class", "/missing"]) {
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
            await raw(middlewarePort, GET("/"));
            assert.equal(counts.Response, 1, "ミドルウェア");
        }),
    );

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
        const app = createApp({ dev: devtools() });
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
    async function disconnectAfter(port: number, path: string, ms = 60) {
        const socket = net.connect(port, "127.0.0.1", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`));
        await sleep(ms);
        socket.destroy();
    }
    const within = <T>(promise: Promise<T>, label: string) =>
        Promise.race([
            promise,
            sleep(2000).then(() => {
                throw new Error(`${label} が届かなかった`);
            }),
        ]);

    test("c.req.signal", async () => {
        const app = createApp();
        let done = () => {};
        const aborted = new Promise<void>((resolve) => (done = resolve));
        app.get("/", (_, c) => {
            c.req.signal.addEventListener("abort", done);
            return new Promise<Response>(() => {});
        });
        await disconnectAfter(await listen(app), "/");

        await within(aborted, "abort");
    });

    test("切断のあとで初めて c.req を読んでも、signal は abort 済み", async () => {
        const app = createApp();
        let done = (_: boolean) => {};
        const seen = new Promise<boolean>((resolve) => (done = resolve));
        app.get("/", async (_, c) => {
            await sleep(120);
            done(c.req.signal.aborted);
            return "x";
        });
        await disconnectAfter(await listen(app), "/", 30);

        assert.equal(await within(seen, "signal"), true);
    });

    test("new Request(c.req) と c.req.clone()", async () => {
        const app = createApp();
        const events: string[] = [];
        let done = () => {};
        const both = new Promise<void>((resolve) => (done = resolve));
        const mark = (name: string) => () => {
            events.push(name);
            if (events.length === 2) done();
        };
        app.get("/", (_, c) => {
            new Request(c.req).signal.addEventListener("abort", mark("copy"));
            c.req.clone().signal.addEventListener("abort", mark("clone"));
            return new Promise<Response>(() => {});
        });
        await disconnectAfter(await listen(app), "/");

        await within(both, "abort");
        assert.deepEqual(events.sort(), ["clone", "copy"]);
    });

    test("fetch(c.req) の相手への接続も切れる", async () => {
        let closed = () => {};
        const upstreamClosed = new Promise<void>((resolve) => (closed = resolve));
        const hanging = createServer((req) => req.socket.once("close", closed)).listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => hanging.once("listening", resolve));
        const hangingPort = (hanging.address() as AddressInfo).port;
        try {
            const app = createApp();
            app.get("/", async (_, c) => (await fetch(new Request(`http://127.0.0.1:${hangingPort}/`, c.req)).catch(() => new Response("x"))));
            await disconnectAfter(await listen(app), "/", 120);

            await within(upstreamClosed, "上流の切断");
        } finally {
            hanging.closeAllConnections();
            hanging.close();
        }
    });

    test("応答を返したあとに読んだ signal は abort されていない", async () => {
        const app = createApp();
        let done = (_: boolean) => {};
        const seen = new Promise<boolean>((resolve) => (done = resolve));
        app.get("/", (_, c) => {
            setTimeout(() => done(c.req.signal.aborted), 30);
            return "x";
        });
        await raw(await listen(app), GET("/"));

        assert.equal(await within(seen, "signal"), false);
    });
});
