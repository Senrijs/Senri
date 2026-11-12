// 本文の既定の上限(createApp({ maxBodySize })。既定は 1 MiB)と、それを置き換えるもの
import { describe, expect, test } from "bun:test";
import { bodyLimit, createApp, defineRoutes, endpoint, uploadLimit } from "../src/index.ts";
import { multipart } from "../src/multipart.ts";
import { devtools } from "../src/dev/index.ts";

const MIB = 1024 * 1024;

// Content-Length の付かない(チャンク転送の)本文
// highWaterMark: 0 で、読まれるまで pull しない(既定の 1 だと、作った時点で 1 回 pull する)
const chunked = (size: number, onPull?: () => void) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                onPull?.();
                if (sent >= size) return controller.close();
                const n = Math.min(64 * 1024, size - sent);
                sent += n;
                controller.enqueue(new Uint8Array(n));
            },
        },
        { highWaterMark: 0 },
    );
};
const post = (app: { fetch(req: Request): Promise<Response> }, path: string, body: BodyInit, headers: Record<string, string> = {}) =>
    app.fetch(new Request(`http://localhost${path}`, { method: "POST", body, headers, duplex: "half" } as RequestInit));

function readingApp(options?: Parameters<typeof createApp>[0]) {
    const app = createApp(options);
    app.post("/text", async (_, c) => `${(await c.req.text()).length}`);
    app.post("/body", async (_, c) => `${String(await c.body()).length}`);
    app.post("/ignore", () => "not read");
    app.post("/swallow", async (_, c) => {
        try {
            await c.req.arrayBuffer();
        } catch {}
        return "swallowed";
    });
    return app;
}

describe("既定の上限(1 MiB)", () => {
    const app = readingApp();

    test("1 MiB までは読める。超えたら 413(Content-Length あり・なし)", async () => {
        expect(await (await post(app, "/text", "x".repeat(MIB))).text()).toBe(String(MIB));
        expect((await post(app, "/text", "x".repeat(MIB + 1))).status).toBe(413);
        expect(await (await post(app, "/text", chunked(MIB))).text()).toBe(String(MIB));
        const over = await post(app, "/text", chunked(MIB + 1));
        expect(over.status).toBe(413);
        expect(await over.text()).toBe("413 Content Too Large");
    });

    test("c.body() とルートの body のスキーマにも効く", async () => {
        expect((await post(app, "/body", "x".repeat(MIB + 1), { "content-type": "text/plain" })).status).toBe(413);
        const schemaApp = createApp();
        schemaApp.routes(
            defineRoutes({
                "POST /s": endpoint({ body: { "~standard": { version: 1, vendor: "t", validate: (value: unknown) => ({ value }) } } }, () => "ok"),
            }),
        );
        expect((await post(schemaApp, "/s", JSON.stringify({ a: "x".repeat(MIB) }), { "content-type": "application/json" })).status).toBe(413);
    });

    test("本文を読まないルートは変わらない(大きくても 200)", async () => {
        expect(await (await post(app, "/ignore", "x".repeat(2 * MIB))).text()).toBe("not read");
    });

    test("ハンドラーが読み取りのエラーを握りつぶしても 413", async () => {
        expect((await post(app, "/swallow", chunked(MIB + 1))).status).toBe(413);
    });

    test("Content-Length が上限より大きければ、中身をハンドラーに渡さずに 413(残りは読み捨てる)", async () => {
        const app2 = createApp();
        let handled = false;
        app2.post("/text", async (_, c) => {
            await c.req.text();
            handled = true;
            return "read";
        });
        let pulls = 0;
        const res = await post(app2, "/text", chunked(3 * MIB, () => pulls++), { "content-length": String(2 * MIB) });
        expect(res.status).toBe(413);
        expect(handled).toBe(false);
        // 残りは裏で読み捨てる(待ち続けない)
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(pulls).toBeGreaterThan(0);
    });

    test("本文のないリクエストでは、c.req を差し替えない", async () => {
        const app2 = createApp();
        let same = false;
        const req = new Request("http://localhost/x");
        app2.get("/x", (_, c) => ((same = c.req === req), "ok"));
        await app2.fetch(req);
        expect(same).toBe(true);
    });
});

describe("c.req.body を自分でストリームとして読むとき", () => {
    // 読んだバイト数を返す。読み取りが失敗したら、そのエラーを投げる(→ 413)
    const streamApp = (withLimit: boolean) => {
        const app = createApp();
        if (withLimit) app.use("/stream", bodyLimit({ maxSize: 5 * MIB }));
        app.post("/stream", async (_, c) => {
            let size = 0;
            const reader = c.req.body!.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
            }
            return String(size);
        });
        return app;
    };

    test("1 MiB を超えると 413(Content-Length あり・なしの両方)", async () => {
        const app = streamApp(false);
        expect(await (await post(app, "/stream", chunked(MIB))).text()).toBe(String(MIB));
        expect((await post(app, "/stream", chunked(MIB + 1))).status).toBe(413);
        expect((await post(app, "/stream", chunked(2 * MIB), { "content-length": String(2 * MIB) })).status).toBe(413);
    });

    test("大きい本文を流すルートは、bodyLimit({ maxSize }) で上限を上げる", async () => {
        const app = streamApp(true);
        expect(await (await post(app, "/stream", chunked(3 * MIB))).text()).toBe(String(3 * MIB));
        expect(await (await post(app, "/stream", chunked(3 * MIB), { "content-length": String(3 * MIB) })).text()).toBe(String(3 * MIB));
    });
});

describe("createApp({ maxBodySize })", () => {
    test("上限を変えられる。Infinity で外せる", async () => {
        const small = readingApp({ maxBodySize: 10 });
        expect((await post(small, "/text", "x".repeat(10))).status).toBe(200);
        expect((await post(small, "/text", "x".repeat(11))).status).toBe(413);
        const none = readingApp({ maxBodySize: Infinity });
        expect(await (await post(none, "/text", "x".repeat(2 * MIB))).text()).toBe(String(2 * MIB));
    });

    test("負の数や数でない値は RangeError", () => {
        for (const value of [-1, Number.NaN, "1" as unknown as number]) expect(() => createApp({ maxBodySize: value })).toThrow(RangeError);
    });

    test("開発モードでも同じ", async () => {
        const app = readingApp({ dev: devtools({ lang: "en" }) });
        const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
        const send = (body: BodyInit) =>
            app.fetch(new Request("http://localhost:3927/text", { method: "POST", body, headers: { host: "localhost:3927" }, duplex: "half" } as RequestInit), local);
        expect((await send("x".repeat(MIB))).status).toBe(200);
        expect((await send(chunked(MIB + 1))).status).toBe(413);
    });
});

describe("ルートの上限は、既定を置き換える", () => {
    test("bodyLimit() を付けたルートは、その上限まで読める(既定の 1 MiB を超えても)", async () => {
        const app = createApp();
        app.post("/big", bodyLimit({ maxSize: 5 * MIB }) as never, async () => "x");
        app.use("/limited", bodyLimit({ maxSize: 5 * MIB }));
        app.post("/limited", async (_, c) => `${(await c.req.text()).length}`);
        expect(await (await post(app, "/limited", "x".repeat(2 * MIB))).text()).toBe(String(2 * MIB));
        expect(await (await post(app, "/limited", chunked(2 * MIB))).text()).toBe(String(2 * MIB));
        // bodyLimit() 自身の上限は効く
        expect((await post(app, "/limited", chunked(5 * MIB + 1))).status).toBe(413);
    });

    test("endpoint({ use: [bodyLimit()] }) でも置き換えられる", async () => {
        const app = createApp();
        app.routes(defineRoutes({ "POST /e": endpoint({ use: [bodyLimit({ maxSize: 3 * MIB })] }, async (_, c) => `${(await c.req.text()).length}`) }));
        expect(await (await post(app, "/e", "x".repeat(2 * MIB))).text()).toBe(String(2 * MIB));
    });

    test("uploadLimit() は maxTotalSize まで受け取れる", async () => {
        const app = createApp();
        app.use("/upload", uploadLimit({ maxTotalSize: 5 * MIB }));
        app.post("/upload", async (_, c) => {
            const body = (await c.body()) as Record<string, File>;
            return String(body.file?.size);
        });
        const form = new FormData();
        form.append("file", new File([new Uint8Array(2 * MIB)], "a.bin"));
        expect(await (await post(app, "/upload", form)).text()).toBe(String(2 * MIB));
    });

    test("multipart() は自分の上限(既定の合計は 100 MiB)を使う", async () => {
        const app = createApp();
        app.post("/mp", async (_, c) => {
            let size = 0;
            for await (const part of multipart(c)) size += (await part.bytes()).length;
            return String(size);
        });
        const form = new FormData();
        form.append("file", new File([new Uint8Array(2 * MIB)], "a.bin"));
        expect(await (await post(app, "/mp", form)).text()).toBe(String(2 * MIB));
    });
});

describe("multipart() の合計の上限の既定", () => {
    const send = (limits: Parameters<typeof multipart>[1], size: number) => {
        const app = createApp();
        app.post("/mp", async (_, c) => {
            for await (const part of multipart(c, limits)) await part.bytes();
            return "ok";
        });
        const form = new FormData();
        form.append("file", new File([new Uint8Array(size)], "a.bin"));
        return post(app, "/mp", form);
    };

    test("maxTotalSize を書けば、それが合計の上限", async () => {
        expect((await send({ maxTotalSize: MIB }, 2 * MIB)).status).toBe(413);
    });

    test("maxFileSize を既定の合計(100 MiB)より大きくしたら、合計もそれに合わせる", async () => {
        // ここでは小さい数で、合計が maxFileSize に合わせて上がることだけ確かめる(既定の合計を超える本文は送らない)
        expect((await send({ maxFileSize: 3 * MIB, maxTotalSize: 2 * MIB }, 2.5 * MIB)).status).toBe(413);
        expect((await send({ maxFileSize: 3 * MIB }, 2.5 * MIB)).status).toBe(200);
    });
});
