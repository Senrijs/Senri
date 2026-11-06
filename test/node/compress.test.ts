// compress() の Node の近道。小さい本文なら Request / Response を作らない。応答は app.fetch を通す道と同じ
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { gunzipSync, inflateSync } from "node:zlib";
import { compress, cors, createApp, etag, secureHeaders } from "../../src/index.ts";
import { bothPaths, closeServers, counting, listen } from "./http.ts";

after(closeServers);

const BIG = "hello world ".repeat(200);

type Answer = { status: number; headers: [string, string][]; body: string };

// 本文を展開してから比べる(チャンクの区切りは道によって変わるので、生のバイト列では比べない)
function get(port: number, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Answer> {
    return new Promise((resolve, reject) => {
        const req = httpRequest({ port, host: "127.0.0.1", path, method, headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const raw = Buffer.concat(chunks);
                const encoding = res.headers["content-encoding"];
                const body = encoding === "gzip" ? gunzipSync(raw) : encoding === "deflate" ? inflateSync(raw) : raw;
                const list = Object.entries(res.headers)
                    .filter(([name]) => name !== "date" && name !== "connection" && name !== "keep-alive")
                    .map(([name, value]): [string, string] => [name, String(value)])
                    .sort(([a], [b]) => a.localeCompare(b));
                resolve({ status: res.statusCode!, headers: list, body: body.toString() });
            });
        });
        req.on("error", reject);
        req.end();
    });
}

const headerIn = (answer: Answer, name: string) => answer.headers.find(([key]) => key === name)?.[1];

function makeApp() {
    const app = createApp();
    app.use(compress());
    app.get("/small", () => "small");
    app.get("/small-json", () => ({ a: 1 }));
    app.get("/big", () => BIG);
    app.get("/big-json", () => ({ text: BIG }));
    app.get("/utf8", () => "あ".repeat(400));
    app.get("/c-text", (_, c) => c.text(BIG));
    app.get("/response", () => new Response(BIG, { headers: { "content-type": "text/plain" } }));
    app.get("/png", () => new Response(BIG, { headers: { "content-type": "image/png" } }));
    app.get("/status", (_, c) => {
        c.status(201);
        return BIG;
    });
    app.get("/own", (_, c) => {
        c.header("x-own", "1");
        c.header("set-cookie", "a=1");
        return BIG;
    });
    app.get("/own-type", (_, c) => {
        c.header("content-type", "application/x-custom");
        return BIG;
    });
    app.get("/own-html", (_, c) => {
        c.header("content-type", "text/html");
        return BIG;
    });
    app.get("/empty", () => "");
    app.get("/boom", () => {
        throw new Error("boom");
    });
    app.post("/big", () => BIG);
    return app;
}

const PATHS = ["/small", "/small-json", "/big", "/big-json", "/utf8", "/c-text", "/response", "/png", "/status", "/own", "/own-type", "/own-html", "/empty", "/boom", "/none"];
const ACCEPTS: Record<string, string>[] = [{}, { "Accept-Encoding": "gzip" }, { "Accept-Encoding": "deflate" }, { "Accept-Encoding": "gzip;q=0, deflate" }, { "Accept-Encoding": "br" }];

describe("compress() と Node の近道", () => {
    test("小さい本文なら、Request も Response も作らない", async () => {
        const app = makeApp();
        const port = await listen(app);
        for (const path of ["/small", "/small-json"]) {
            const counts = await counting(async () => {
                const answer = await get(port, path, { "Accept-Encoding": "gzip" });
                assert.equal(headerIn(answer, "content-encoding"), undefined);
                assert.equal(headerIn(answer, "vary"), undefined);
            });
            assert.deepEqual(counts, { Request: 0, Response: 0 }, path);
        }
    });

    test("大きい本文でも、受け取れないクライアントなら Response を作らない", async () => {
        const port = await listen(makeApp());

        const counts = await counting(async () => {
            const answer = await get(port, "/big");
            assert.equal(headerIn(answer, "vary"), "Accept-Encoding");
            assert.equal(answer.body, BIG);
        });
        assert.deepEqual(counts, { Request: 0, Response: 0 });
    });

    test("圧縮するときは Response を1つだけ作る。Request は作らない", async () => {
        const port = await listen(makeApp());

        const counts = await counting(async () => {
            const answer = await get(port, "/big", { "Accept-Encoding": "gzip" });
            assert.equal(headerIn(answer, "content-encoding"), "gzip");
            assert.equal(answer.body, BIG);
        });
        assert.deepEqual(counts, { Request: 0, Response: 1 });
    });

    test("2つの道の応答が同じ", async () => {
        const { lazy, viaFetch } = await bothPaths(makeApp());
        for (const path of PATHS) {
            for (const headers of ACCEPTS) {
                for (const method of ["GET", "HEAD", "POST"]) {
                    const label = `${method} ${path} ${JSON.stringify(headers)}`;
                    assert.deepEqual(await get(lazy, path, headers, method), await get(viaFetch, path, headers, method), label);
                }
            }
        }
    });

    test("etag() や、ほかの純正のミドルウェアと一緒でも、2つの道の応答が同じ", async () => {
        const app = createApp();
        app.use(compress());
        app.use(etag());
        app.use(secureHeaders());
        app.use(cors());
        app.get("/big", () => BIG);
        app.get("/small", () => "small");
        const { lazy, viaFetch } = await bothPaths(app);
        for (const path of ["/big", "/small"]) {
            for (const headers of ACCEPTS) {
                const withOrigin = { ...headers, Origin: "https://a.example" };
                const answer = await get(lazy, path, withOrigin);
                assert.deepEqual(answer, await get(viaFetch, path, withOrigin), path);
                const tag = headerIn(answer, "etag")!;
                assert.ok(tag.startsWith('W/"'));

                const conditional = { ...withOrigin, "If-None-Match": tag };
                const again = await get(lazy, path, conditional);
                assert.equal(again.status, 304);
                assert.deepEqual(again, await get(viaFetch, path, conditional), `${path} 304`);
            }
        }
    });

    test("Node 自身の圧縮と重ならない(1回だけ展開すれば読める)", async () => {
        const port = await listen(makeApp());
        const answer = await get(port, "/big-json", { "Accept-Encoding": "deflate" });

        assert.deepEqual(JSON.parse(answer.body), { text: BIG });
        assert.equal(headerIn(answer, "content-length"), undefined);
    });
});
