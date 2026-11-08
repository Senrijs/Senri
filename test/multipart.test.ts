import { describe, expect, test } from "bun:test";
import { createApp, HttpError, type Context } from "../src/index.ts";
import { multipart, type MultipartLimits, type MultipartPart } from "../src/multipart.ts";
import { explainText } from "../src/dev/explain.ts";

const encoder = new TextEncoder();
const BOUNDARY = "----senri-boundary-7MA4YWxkTrZu0gW";
const TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

type Piece = { name: string; filename?: string; type?: string; headers?: string[]; body: string | Uint8Array };

// multipart/form-data の本文を、自分で組み立てる(ブラウザが送るのと同じ形)
function build(pieces: Piece[], { preamble = "", epilogue = "", boundary = BOUNDARY } = {}): Uint8Array<ArrayBuffer> {
    const chunks: Uint8Array[] = [encoder.encode(preamble)];
    for (const piece of pieces) {
        let head = `--${boundary}\r\nContent-Disposition: form-data; name="${piece.name}"`;
        if (piece.filename !== undefined) head += `; filename="${piece.filename}"`;
        head += "\r\n";
        if (piece.type) head += `Content-Type: ${piece.type}\r\n`;
        for (const line of piece.headers ?? []) head += `${line}\r\n`;
        chunks.push(encoder.encode(`${head}\r\n`), typeof piece.body === "string" ? encoder.encode(piece.body) : piece.body, encoder.encode("\r\n"));
    }
    chunks.push(encoder.encode(`--${boundary}--\r\n${epilogue}`));
    return join(chunks);
}

function join(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

const raw = (text: string) => encoder.encode(text.replaceAll("\n", "\r\n"));

// 決めた区切りでチャンクを流すストリーム。読まれた回数と、cancel されたかを記録する
function source(chunks: Uint8Array[]) {
    const state = { pulls: 0, cancelled: false };
    let i = 0;
    const stream = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                state.pulls++;
                if (i < chunks.length) controller.enqueue(chunks[i++]!);
                else controller.close();
            },
            cancel() {
                state.cancelled = true;
            },
        },
        { highWaterMark: 0 },
    );
    return { stream, state };
}

const split = (bytes: Uint8Array, at: number[]) => [0, ...at, bytes.length].slice(1).map((end, i, ends) => bytes.subarray(i === 0 ? 0 : ends[i - 1]!, end));
const everyByte = (bytes: Uint8Array) => Array.from(bytes, (_, i) => bytes.subarray(i, i + 1));

// c.req の代わり。本文を決めたチャンクで渡す
function contextOf(body: ReadableStream<Uint8Array> | null, contentType: string | null = TYPE): Context {
    const headers = new Headers();
    if (contentType !== null) headers.set("content-type", contentType);
    return { req: { headers, body, bodyUsed: false } } as unknown as Context;
}

type Seen = { name: string; filename: string | undefined; contentType: string; body: string };
async function readAll(c: Context, limits?: MultipartLimits): Promise<Seen[]> {
    const seen: Seen[] = [];
    for await (const part of multipart(c, limits)) {
        seen.push({ name: part.name, filename: part.filename, contentType: part.contentType, body: await part.text() });
    }
    return seen;
}
const readChunks = (chunks: Uint8Array[], limits?: MultipartLimits) => readAll(contextOf(source(chunks).stream), limits);

async function failure(run: () => Promise<unknown>): Promise<{ status?: number; code?: string; message: string }> {
    try {
        await run();
    } catch (err) {
        return { status: err instanceof HttpError ? err.status : undefined, code: (err as { code?: string }).code, message: (err as Error).message };
    }
    throw new Error("失敗しなかった");
}

const SAMPLE: Piece[] = [
    { name: "title", body: "こんにちは" },
    { name: "empty", body: "" },
    // 区切りに似た並びを中身に入れる(改行のない --boundary、途中まで同じもの)
    { name: "file", filename: "a.txt", type: "text/plain", body: `x\r\n--${BOUNDARY.slice(0, 10)}y--${BOUNDARY}\r\n-\r\n\r\n` },
    { name: "bin", filename: "b.bin", type: "application/octet-stream", body: new Uint8Array([0, 13, 10, 45, 45, 255, 13]) },
];
const EXPECTED: Seen[] = [
    { name: "title", filename: undefined, contentType: "text/plain", body: "こんにちは" },
    { name: "empty", filename: undefined, contentType: "text/plain", body: "" },
    { name: "file", filename: "a.txt", contentType: "text/plain", body: `x\r\n--${BOUNDARY.slice(0, 10)}y--${BOUNDARY}\r\n-\r\n\r\n` },
    { name: "bin", filename: "b.bin", contentType: "application/octet-stream", body: new TextDecoder().decode(new Uint8Array([0, 13, 10, 45, 45, 255, 13])) },
];

describe("multipart(): 読み取り", () => {
    test("フィールドとファイルを順に読める", async () => {
        expect(await readChunks([build(SAMPLE)])).toEqual(EXPECTED);
    });

    test("ブラウザと同じ FormData の本文も読める(app.fetch で)", async () => {
        const app = createApp();
        app.post("/", async (_, c) => {
            const out: [string, string | undefined, number][] = [];
            for await (const part of multipart(c)) out.push([part.name, part.filename, (await part.bytes()).length]);
            return out;
        });
        const form = new FormData();
        form.append("a", "1");
        form.append("photo", new File([new Uint8Array(300_000)], "写真.png", { type: "image/png" }));
        const res = await app.fetch(new Request("http://localhost/", { method: "POST", body: form }));

        expect(await res.json()).toEqual([
            ["a", null, 1],
            ["photo", "写真.png", 300_000],
        ]);
    });

    test("区切りがチャンクの切れ目をまたいでも、どこで切れても同じに読める", async () => {
        const body = build(SAMPLE);
        for (let at = 1; at < body.length; at++) {
            expect({ at, seen: await readChunks(split(body, [at])) }).toEqual({ at, seen: EXPECTED });
        }
    });

    test("1バイトずつ届いても読める", async () => {
        expect(await readChunks(everyByte(build(SAMPLE)))).toEqual(EXPECTED);
    });

    test("前置き・後書き・区切りのあとの空白を読み飛ばす", async () => {
        const body = raw(`前置き\n--${BOUNDARY}  \t\nContent-Disposition: form-data; name="a"\n\n1\n--${BOUNDARY}--\n後書き`);
        expect(await readChunks(everyByte(body))).toEqual([{ name: "a", filename: undefined, contentType: "text/plain", body: "1" }]);
    });

    test("ヘッダー: filename* は filename より優先。引用符の中の \\\" と UTF-8 の名前", async () => {
        const body = raw(
            `--${BOUNDARY}\nContent-Disposition: form-data; name="f"; filename="fallback.txt"; filename*=UTF-8''%E3%81%82.txt\nX-Extra: 1\n\nx\n` +
                `--${BOUNDARY}\ncontent-disposition: FORM-DATA; name="say \\"hi\\""; filename="C:\\dir\\名前.txt"\n\ny\n` +
                `--${BOUNDARY}\nContent-Disposition: form-data; name=plain\n\nz\n--${BOUNDARY}--`,
        );
        const parts: { name: string; filename: string | undefined; extra: string | null }[] = [];
        for await (const part of multipart(contextOf(source([body]).stream))) {
            parts.push({ name: part.name, filename: part.filename, extra: part.headers.get("x-extra") });
            await part.text();
        }

        expect(parts).toEqual([
            { name: "f", filename: "あ.txt", extra: "1" },
            { name: 'say "hi"', filename: "C:\\dir\\名前.txt", extra: null },
            { name: "plain", filename: undefined, extra: null },
        ]);
    });

    test("引用符付きの boundary", async () => {
        const body = build([{ name: "a", body: "1" }], { boundary: "a b" });
        expect(await readAll(contextOf(source([body]).stream, 'multipart/form-data; charset=utf-8; boundary="a b"'))).toEqual([
            { name: "a", filename: undefined, contentType: "text/plain", body: "1" },
        ]);
    });

    test("パーツが1つもない本文", async () => {
        expect(await readChunks([raw(`--${BOUNDARY}--\n`)])).toEqual([]);
    });
});

describe("multipart(): 読み切らずに次へ進んだとき", () => {
    test("読み残しは読み飛ばして、次のパーツを渡す", async () => {
        const names: string[] = [];
        let last = "";
        for await (const part of multipart(contextOf(source(everyByte(build(SAMPLE))).stream))) {
            names.push(part.name);
            if (part.name === "bin") last = String((await part.bytes()).length);
        }
        expect(names).toEqual(["title", "empty", "file", "bin"]);
        expect(last).toBe("7");
    });

    test("途中まで読んだパーツも、残りを読み飛ばす", async () => {
        const big = "a".repeat(100_000);
        const seen: string[] = [];
        for await (const part of multipart(contextOf(source(split(build([{ name: "big", filename: "a", body: big }, { name: "next", body: "ok" }]), [1000, 2000])).stream))) {
            if (part.name === "big") await part.stream.getReader().read();
            else seen.push(await part.text());
        }
        expect(seen).toEqual(["ok"]);
    });

    test("読み飛ばしたパーツの stream を、あとから読むとエラー", async () => {
        const parts: MultipartPart[] = [];
        for await (const part of multipart(contextOf(source([build(SAMPLE)]).stream))) parts.push(part);

        const err = await failure(() => parts[0]!.text());
        expect(err.code).toBe("multipart_part_skipped");
        expect(explainText(err, "ja")).toContain("ループが次のパーツへ進んだ");
    });

    test("ループを途中で抜けたら、それ以上は読まない", async () => {
        const { stream, state } = source(everyByte(build(SAMPLE)));
        for await (const part of multipart(contextOf(stream))) {
            if (part.name === "title") break;
        }
        expect(state.cancelled).toBe(true);
    });
});

describe("multipart(): 上限", () => {
    const files = (n: number) => Array.from({ length: n }, (_, i): Piece => ({ name: `f${i}`, filename: `${i}.txt`, body: "x" }));

    test("パーツの数(既定は 100)", async () => {
        expect(await readChunks([build(files(100))])).toHaveLength(100);
        expect((await failure(() => readChunks([build(files(101))]))).status).toBe(413);
        expect((await failure(() => readChunks([build(files(3))], { maxParts: 2 }))).status).toBe(413);
    });

    test("ファイル1つの大きさ。part.stream がエラーになり、ループも同じエラーで止まる", async () => {
        const body = build([{ name: "f", filename: "a.bin", body: "x".repeat(11) }, { name: "after", body: "1" }]);
        expect(await readChunks([body], { maxFileSize: 11 })).toHaveLength(2);

        const { stream, state } = source(everyByte(body));
        const seen: string[] = [];
        const err = await failure(async () => {
            for await (const part of multipart(contextOf(stream), { maxFileSize: 10 })) {
                seen.push(part.name);
                const streamError = await failure(() => part.bytes());
                expect(streamError.status).toBe(413);
            }
        });
        expect(err.status).toBe(413);
        expect(seen).toEqual(["f"]);
        expect(state.cancelled).toBe(true);
    });

    test("既定のファイルの上限は 10 MiB", async () => {
        const size = 10 * 1024 * 1024;
        expect(await readChunks([build([{ name: "f", filename: "a", body: new Uint8Array(size) }])])).toHaveLength(1);
        expect((await failure(() => readChunks([build([{ name: "f", filename: "a", body: new Uint8Array(size + 1) }])]))).status).toBe(413);
    });

    test("フィールドの大きさ(既定は 64 KiB)。読み飛ばしたときも数える", async () => {
        const field = (size: number) => build([{ name: "a", body: "x".repeat(size) }]);
        expect(await readChunks([field(64 * 1024)])).toHaveLength(1);
        expect((await failure(() => readChunks([field(64 * 1024 + 1)]))).status).toBe(413);
        expect(
            (
                await failure(async () => {
                    for await (const _ of multipart(contextOf(source([field(5)]).stream), { maxFieldSize: 4 }));
                })
            ).status,
        ).toBe(413);
    });

    test("ヘッダーの大きさ(既定は 8 KiB)", async () => {
        const withHeader = (size: number) => build([{ name: "a", headers: [`X-Pad: ${"p".repeat(size)}`], body: "1" }]);
        // Content-Disposition と X-Pad: と行の区切りを合わせて、ちょうど上限になる長さ
        const fixed = `Content-Disposition: form-data; name="a"\r\nX-Pad: `.length;
        expect(await readChunks(everyByte(withHeader(8 * 1024 - fixed)))).toHaveLength(1);
        expect((await failure(() => readChunks(everyByte(withHeader(8 * 1024 - fixed + 1))))).status).toBe(413);
        expect((await failure(() => readChunks([withHeader(100)], { maxHeaderSize: 50 }))).status).toBe(413);
    });

    test("本文全体の大きさ", async () => {
        const body = build(SAMPLE);
        expect(await readChunks([body], { maxTotalSize: body.length })).toEqual(EXPECTED);
        expect((await failure(() => readChunks(everyByte(body), { maxTotalSize: body.length - 1 }))).status).toBe(413);
    });

    test("上限の値がおかしければ、呼んだときのエラー", async () => {
        for (const limits of [{ maxParts: -1 }, { maxFileSize: Number.NaN }, { maxFieldSize: "1" }, null]) {
            const err = await failure(async () => multipart(contextOf(source([]).stream), limits as never));
            expect(err.code).toBe("multipart_limits");
        }
        expect(explainText({ code: "multipart_limits" }, "en")).toContain("0 or more");
    });
});

describe("multipart(): 壊れたデータ", () => {
    const cases: [string, Uint8Array][] = [
        ["終わりの区切りがない", raw(`--${BOUNDARY}\nContent-Disposition: form-data; name="a"\n\n1`)],
        ["ヘッダーの途中で終わる", raw(`--${BOUNDARY}\nContent-Disposition: form-data; name="a"`)],
        ["区切りが1つもない", raw("hello")],
        ["コロンのないヘッダー", raw(`--${BOUNDARY}\nContent-Disposition form-data\n\n1\n--${BOUNDARY}--`)],
        ["Content-Disposition がない", raw(`--${BOUNDARY}\nContent-Type: text/plain\n\n1\n--${BOUNDARY}--`)],
        ["form-data ではない", raw(`--${BOUNDARY}\nContent-Disposition: attachment; name="a"\n\n1\n--${BOUNDARY}--`)],
        ["name がない", raw(`--${BOUNDARY}\nContent-Disposition: form-data; filename="a"\n\n1\n--${BOUNDARY}--`)],
        ["閉じていない引用符", raw(`--${BOUNDARY}\nContent-Disposition: form-data; name="a\n\n1\n--${BOUNDARY}--`)],
        ["区切りのあとに改行がない", raw(`--${BOUNDARY}x\nContent-Disposition: form-data; name="a"\n\n1\n--${BOUNDARY}--`)],
        ["空の本文", new Uint8Array(0)],
    ];
    for (const [name, body] of cases) {
        test(`${name}なら 400`, async () => {
            expect((await failure(() => readChunks([body]))).status).toBe(400);
            expect((await failure(() => readChunks(everyByte(body)))).status).toBe(400);
        });
    }

    test("前置きが長すぎるなら 400", async () => {
        expect((await failure(() => readChunks([raw(`${"x".repeat(100)}\n--${BOUNDARY}--`)], { maxHeaderSize: 10 }))).status).toBe(400);
    });
});

describe("multipart(): 呼べないとき", () => {
    test("multipart/form-data でなければ 415、boundary がなければ 400", async () => {
        expect((await failure(async () => multipart(contextOf(source([]).stream, "application/json")))).status).toBe(415);
        expect((await failure(async () => multipart(contextOf(source([]).stream, null)))).status).toBe(415);
        for (const type of ["multipart/form-data", "multipart/form-data; boundary=", `multipart/form-data; boundary=${"b".repeat(71)}`, 'multipart/form-data; boundary="a b "']) {
            expect({ type, status: (await failure(async () => multipart(contextOf(source([]).stream, type)))).status }).toEqual({ type, status: 400 });
        }
        expect((await failure(async () => multipart(contextOf(null)))).status).toBe(400);
    });

    test("本文を読んだあとや、2回目はエラー", async () => {
        const app = createApp();
        app.post("/read", async (_, c) => {
            await c.req.text();
            return failure(async () => multipart(c));
        });
        app.post("/twice", async (_, c) => {
            multipart(c);
            return failure(async () => multipart(c));
        });
        for (const path of ["/read", "/twice"]) {
            const res = await app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": TYPE }, body: build(SAMPLE) }));
            expect((await res.json()).code).toBe("multipart_body_used");
        }
        expect(explainText({ code: "multipart_body_used" }, "ja")).toContain("uploadLimit()");
    });

    test("上限を超えたら、app.fetch では 413 の応答になる", async () => {
        const app = createApp();
        app.post("/", async (_, c) => {
            for await (const part of multipart(c, { maxFileSize: 1 })) await part.bytes();
            return "ok";
        });
        const res = await app.fetch(new Request("http://localhost/", { method: "POST", headers: { "content-type": TYPE }, body: build([{ name: "f", filename: "a", body: "xx" }]) }));

        expect(res.status).toBe(413);
        expect(await res.text()).toBe("413 Content Too Large");
    });
});

describe("multipart(): メモリにためない", () => {
    // 時間やメモリの量は測らない。本文のストリームが、読んだ分より先に読まれないことを確かめる
    test("本文は、パーツの stream が読まれた分だけ読む", async () => {
        const CHUNK = 64 * 1024;
        const COUNT = 800; // 50 MiB
        const head = raw(`--${BOUNDARY}\nContent-Disposition: form-data; name="f"; filename="big.bin"\n\n`);
        const tail = raw(`\n--${BOUNDARY}--\n`);
        let pulls = 0;
        let sent = 0;
        const body = new ReadableStream<Uint8Array>(
            {
                pull(controller) {
                    pulls++;
                    if (sent === 0) controller.enqueue(head);
                    else if (sent <= COUNT) controller.enqueue(new Uint8Array(CHUNK).fill(sent % 251));
                    else if (sent === COUNT + 1) controller.enqueue(tail);
                    else controller.close();
                    sent++;
                },
            },
            { highWaterMark: 0 },
        );
        let received = 0;
        let ahead = 0;
        for await (const part of multipart(contextOf(body), { maxFileSize: Infinity })) {
            const reader = part.stream.getReader();
            for (let read = 0; ; read++) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.length;
                // 読んだチャンクの数より、本文が先に読まれていない(区切りを探すために、1つ先まではありうる)
                ahead = Math.max(ahead, pulls - read);
            }
        }
        expect(received).toBe(CHUNK * COUNT);
        expect(ahead).toBeLessThanOrEqual(3);
    });
});

describe("multipart()(Bun、本物の HTTP)", () => {
    test("32 MiB のファイルを、ストリームの本文で受け取れる", async () => {
        const CHUNK = 64 * 1024;
        const COUNT = 512;
        const app = createApp();
        app.post("/", async (_, c) => {
            const out: [string, number, number][] = [];
            for await (const part of multipart(c, { maxFileSize: Infinity })) {
                let size = 0;
                let sum = 0;
                const reader = part.stream.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.length;
                    for (const byte of value) sum += byte;
                }
                out.push([part.name, size, sum]);
            }
            return out;
        });
        const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => app.fetch(req), maxRequestBodySize: 1024 * 1024 * 1024 });
        try {
            let i = 0;
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    if (i === 0) controller.enqueue(raw(`--${BOUNDARY}\nContent-Disposition: form-data; name="f"; filename="a.bin"\n\n`));
                    else if (i <= COUNT) controller.enqueue(new Uint8Array(CHUNK).fill(i % 251));
                    else if (i === COUNT + 1) controller.enqueue(raw(`\n--${BOUNDARY}--\n`));
                    else controller.close();
                    i++;
                },
            });
            let sum = 0;
            for (let k = 1; k <= COUNT; k++) sum += (k % 251) * CHUNK;
            const res = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", headers: { "content-type": TYPE }, body, duplex: "half" } as RequestInit);

            expect(await res.json()).toEqual([["f", CHUNK * COUNT, sum]]);
        } finally {
            server.stop(true);
        }
    });
});
