import { describe, expect, test } from "bun:test";
import { bodyLimit, createApp, safeFileName, uploadLimit, type StandardSchemaV1, type UploadLimitOptions } from "../src/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf } from "./bundle.ts";

const MB = 1024 * 1024;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const GIF = new TextEncoder().encode("GIF89a...");
const WEBP = new TextEncoder().encode("RIFF\x01\x02\x03\x04WEBPVP8");
const PDF = new TextEncoder().encode("%PDF-1.7");
const file = (body: BlobPart, name: string, type: string) => new File([body], name, { type });

function appWith(options: UploadLimitOptions) {
    const app = createApp();
    app.use(uploadLimit(options));
    app.post("/", async (_, c) => {
        const form = await c.body<Record<string, unknown>>();
        return { fields: Object.keys(form) };
    });
    return app;
}
const send = (app: ReturnType<typeof appWith>, ...parts: [string, string | File][]) => {
    const form = new FormData();
    for (const [name, value] of parts) form.append(name, value);
    return app.fetch(new Request("http://localhost/", { method: "POST", body: form }));
};

describe("uploadLimit()", () => {
    test("上限の中なら通す。ハンドラーで c.body() を読める", async () => {
        const res = await send(appWith({ maxTotalSize: MB }), ["photo", file(PNG, "a.png", "image/png")], ["title", "x"]);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ fields: ["photo", "title"] });
    });

    test("ハンドラーは同じ File を読める", async () => {
        const app = createApp();
        app.use(uploadLimit({ maxTotalSize: MB }));
        app.post("/", async (_, c) => {
            const { photo } = await c.body<{ photo: File }>();
            return { name: photo.name, type: photo.type, size: photo.size, head: new Uint8Array(await photo.arrayBuffer())[0] };
        });
        const res = await send(app, ["photo", file(PNG, "a.png", "image/png")]);

        expect(await res.json()).toEqual({ name: "a.png", type: "image/png", size: PNG.length, head: 0x89 });
    });

    test("合計の上限: Content-Length があれば読まずに 413", async () => {
        const res = await send(appWith({ maxTotalSize: 100 }), ["a", file("x".repeat(1000), "a.txt", "text/plain")]);

        expect(res.status).toBe(413);
        expect(await res.text()).toBe("413 Content Too Large");
    });

    test("合計の上限: Content-Length がなくても、読みながら 413", async () => {
        const boundary = "BOUNDARY";
        const body = `--${boundary}\r\nContent-Disposition: form-data; name="a"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n${"x".repeat(1000)}\r\n--${boundary}--\r\n`;
        const stream = new Response(body).body!;
        const app = appWith({ maxTotalSize: 100 });
        const res = await app.fetch(new Request("http://localhost/", { method: "POST", body: stream, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }));

        expect(res.status).toBe(413);
    });

    test("1ファイルの上限: 超えたら 413。ちょうどなら通す", async () => {
        const app = appWith({ maxTotalSize: MB, maxFileSize: 10 });

        expect((await send(app, ["a", file("x".repeat(10), "a.txt", "text/plain")])).status).toBe(200);
        expect((await send(app, ["a", file("x".repeat(11), "a.txt", "text/plain")])).status).toBe(413);
        expect((await send(app, ["a", file("x", "a.txt", "text/plain")], ["b", file("x".repeat(11), "b.txt", "text/plain")])).status).toBe(413);
    });

    test("ファイル数の上限: 同じ名前のフィールドも数える。文字の欄は数えない", async () => {
        const app = appWith({ maxTotalSize: MB, maxFiles: 2 });
        const one = () => file("x", "a.txt", "text/plain");

        expect((await send(app, ["a", one()], ["a", one()], ["title", "x"], ["note", "y"])).status).toBe(200);
        expect((await send(app, ["a", one()], ["a", one()], ["a", one()])).status).toBe(413);
        expect((await send(app, ["a", one()], ["b", one()], ["c", one()])).status).toBe(413);
    });

    test("選ばれていない欄(名前のない空のファイル)は数えない", async () => {
        const app = appWith({ maxTotalSize: MB, maxFiles: 0, types: ["image/png"] });

        expect((await send(app, ["a", file("", "", "application/octet-stream")])).status).toBe(200);
    });

    // Bun の formData() は、種類をファイル名の拡張子から決める(送られた Content-Type の扱いは test/node で確かめる)
    test("種類: 一致しなければ 415。ワイルドカードも使える", async () => {
        const exact = appWith({ maxTotalSize: MB, types: ["image/png"], sniff: false });
        const wild = appWith({ maxTotalSize: MB, types: ["image/*"], sniff: false });

        expect((await send(exact, ["a", file("x", "a.png", "image/png")])).status).toBe(200);
        expect((await send(exact, ["a", file("x", "a.jpg", "image/jpeg")])).status).toBe(415);
        expect((await send(exact, ["a", file("x", "noext", "")])).status).toBe(415);
        expect((await send(wild, ["a", file("x", "a.webp", "image/webp")])).status).toBe(200);
        expect((await send(wild, ["a", file("x", "a.html", "text/html")])).status).toBe(415);
    });

    test("拡張子: 一致しなければ 415。大文字小文字は問わない", async () => {
        const app = appWith({ maxTotalSize: MB, extensions: [".png", ".JPG"], sniff: false });

        expect((await send(app, ["a", file("x", "a.PNG", "text/plain")])).status).toBe(200);
        expect((await send(app, ["a", file("x", "a.jpg", "text/plain")])).status).toBe(200);
        expect((await send(app, ["a", file("x", "a.png.exe", "text/plain")])).status).toBe(415);
        expect((await send(app, ["a", file("x", "png", "text/plain")])).status).toBe(415);
    });

    test("中身の先頭: 種類と合わなければ 415", async () => {
        const app = appWith({ maxTotalSize: MB });
        const cases: [BlobPart, string, string][] = [
            [PNG, "a.png", "image/png"],
            [JPEG, "a.jpg", "image/jpeg"],
            [GIF, "a.gif", "image/gif"],
            [WEBP, "a.webp", "image/webp"],
            [PDF, "a.pdf", "application/pdf"],
        ];
        for (const [body, name, type] of cases) {
            expect((await send(app, ["a", file(body, name, type)])).status, type).toBe(200);
            expect((await send(app, ["a", file("<script>alert(1)</script>", name, type)])).status, type).toBe(415);
        }
        expect((await send(app, ["a", file(PNG.slice(0, 3), "a.png", "image/png")])).status).toBe(415);
    });

    test("中身の先頭: 表にない種類は確かめない。sniff: false で消せる", async () => {
        expect((await send(appWith({ maxTotalSize: MB }), ["a", file("x", "a.txt", "text/plain")])).status).toBe(200);
        expect((await send(appWith({ maxTotalSize: MB, sniff: false }), ["a", file("x", "a.png", "image/png")])).status).toBe(200);
    });

    test("check: true のときだけ通す。File と c を受け取る", async () => {
        const seen: unknown[] = [];
        const check = (result: unknown) =>
            appWith({
                maxTotalSize: MB,
                check: async (f, c) => {
                    seen.push(f.name, c.path);
                    return result as boolean;
                },
            });

        expect((await send(check(true), ["a", file("x", "a.txt", "text/plain")])).status).toBe(200);
        expect(seen).toEqual(["a.txt", "/"]);
        for (const value of [false, 1, "yes", undefined]) {
            expect((await send(check(value), ["a", file("x", "a.txt", "text/plain")])).status).toBe(415);
        }
    });

    test("check が投げたら通さない(500)", async () => {
        const app = appWith({
            maxTotalSize: MB,
            check: () => {
                throw new Error("boom");
            },
        });

        expect((await send(app, ["a", file("x", "a.txt", "text/plain")])).status).toBe(500);
    });

    test("拒否はハンドラーを動かさない。onError で本文を変えられる", async () => {
        let called = false;
        const app = createApp();
        app.use(uploadLimit({ maxTotalSize: MB, maxFiles: 0 }));
        app.onError((err) => ({ error: (err as Error).message }));
        app.post("/", () => {
            called = true;
            return "x";
        });
        const res = await send(app, ["a", file("x", "a.txt", "text/plain")]);

        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({ error: "413 Content Too Large" });
        expect(called).toBe(false);
    });

    test("読めないフォームは 400", async () => {
        const res = await appWith({ maxTotalSize: MB }).fetch(new Request("http://localhost/", { method: "POST", body: "not multipart", headers: { "content-type": "multipart/form-data; boundary=x" } }));

        expect(res.status).toBe(400);
    });

    test("multipart 以外は、読まずに通す", async () => {
        let read = true;
        const app = createApp();
        app.use(uploadLimit({ maxTotalSize: 1 }));
        app.post("/", async (_, c) => {
            read = c.req.bodyUsed;
            return c.req.text();
        });
        const res = await app.fetch(new Request("http://localhost/", { method: "POST", body: "long text", headers: { "content-type": "text/plain" } }));

        expect(await res.text()).toBe("long text");
        expect(read).toBe(false);
    });

    test("bodyLimit() と一緒に使える。小さい方で止まる", async () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 100 }));
        app.use(uploadLimit({ maxTotalSize: MB }));
        app.post("/", () => "x");

        expect((await send(app as never, ["a", file("x".repeat(1000), "a.txt", "text/plain")])).status).toBe(413);
    });

    test("ルートのスキーマは、検証のあとで同じ File を受け取る", async () => {
        const order: string[] = [];
        const schema: StandardSchemaV1<unknown, { photo: File }> = {
            "~standard": {
                version: 1,
                vendor: "test",
                validate(value) {
                    order.push("schema");
                    const photo = (value as { photo?: unknown }).photo;
                    return photo instanceof File ? { value: { photo } } : { issues: [{ message: "photo is required" }] };
                },
            },
        };
        const app = createApp();
        app.use(uploadLimit({ maxTotalSize: MB, types: ["image/png"] }));
        app.post("/", { body: schema }, (_, c) => c.valid("body").photo.name);

        const good = await send(app as never, ["photo", file(PNG, "a.png", "image/png")]);
        expect(await good.text()).toBe("a.png");
        expect(order).toEqual(["schema"]);

        order.length = 0;
        expect((await send(app as never, ["photo", file(PNG, "a.txt", "text/plain")])).status).toBe(415);
        expect(order).toEqual([]);

        expect((await send(app as never, ["other", "x"])).status).toBe(400);
    });

    test.each([
        [{}],
        [{ maxTotalSize: -1 }],
        [{ maxTotalSize: Number.POSITIVE_INFINITY }],
        [{ maxTotalSize: "1" }],
        [{ maxTotalSize: 1, maxFileSize: -1 }],
        [{ maxTotalSize: 1, maxFiles: -1 }],
        [{ maxTotalSize: 1, types: "image/png" }],
        [{ maxTotalSize: 1, types: [""] }],
        [{ maxTotalSize: 1, extensions: ["png"] }],
        [{ maxTotalSize: 1, check: "yes" }],
    ])("設定が不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            uploadLimit(options as UploadLimitOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err, "ja")).toContain("uploadLimit()");
    });

    test("名前と印", () => {
        const middleware = uploadLimit({ maxTotalSize: 1 });

        expect(middleware.name).toBe("uploadLimit");
        expect(isPlainSafe(middleware)).toBe(true);
    });

    test("使わなければ、本体に入らない", async () => {
        expect(await bundleOf("createApp")).not.toContain("uploadLimit");
    });
});

describe("safeFileName()", () => {
    test.each([
        ["photo.png", "photo.png"],
        ["写真.png", "写真.png"],
        ["../../etc/passwd", "passwd"],
        ["..\\..\\windows\\system32\\cmd.exe", "cmd.exe"],
        ["C:\\temp\\a.png", "a.png"],
        ["/etc/passwd", "passwd"],
        ["a/../b.png", "b.png"],
        ["..", "file"],
        [".", "file"],
        ["...", "file"],
        ["", "file"],
        ["   ", "file"],
        ["/", "file"],
        ["dir/", "file"],
        [".env", "env"],
        [".. .png", "png"],
        ["a.png. .", "a.png"],
        ["a\u0000b.png", "ab.png"],
        ["a\r\nb.png", "ab.png"],
        ['a<>:"|?*b.png', "ab.png"],
        ["CON", "_CON"],
        ["nul.txt", "_nul.txt"],
        ["com1.png", "_com1.png"],
        ["console.png", "console.png"],
        ["a..b.png", "a..b.png"],
    ])("%j → %j", (name, expected) => {
        expect(safeFileName(name)).toBe(expected);
    });

    test("どんな入力でも、区切りと .. だけの名前にならない", () => {
        const pieces = ["..", "/", "\\", ".", " ", "a", "\0", "%2e", ":"];
        for (let i = 0; i < 2000; i++) {
            const name = Array.from({ length: (i % 8) + 1 }, (_, k) => pieces[(i * 7 + k * 3) % pieces.length]).join("");
            const safe = safeFileName(name);

            expect(safe).not.toMatch(/[\\/\0:]/);
            expect(safe).not.toBe("..");
            expect(safe).not.toBe(".");
            expect(safe.length).toBeGreaterThan(0);
        }
    });

    test("長い悪い入力でも、すぐ終わる(末尾の . と空白を削る時間が、長さの 2 乗にならない)", () => {
        // 以前の /[.\s]+$/ は、. や空白が長く続いて最後が別の文字のとき、10 万文字で 10 秒ほどかかった
        const cases: [string, string][] = [
            [" ".repeat(100_000) + "x", "x"],
            [".".repeat(100_000) + "x", "x"],
            [". ".repeat(50_000) + "x", "x"],
            // 先頭が別の文字なら、先頭の削りでは消えない。200 文字で切ると . と空白だけが残るので、削って "a"
            ["a" + " ".repeat(100_000) + "x", "a"],
            ["a" + ".".repeat(100_000) + "x", "a"],
            // タブは制御文字なので、先に消える
            ["a" + "\t".repeat(100_000) + "x", "ax"],
            ["a" + "　".repeat(100_000) + "x", "a"],
            // 末尾だけが長いとき
            ["a.png" + ". ".repeat(100_000), "a.png"],
        ];
        for (const [name, expected] of cases) {
            const started = performance.now();
            const safe = safeFileName(name);
            expect(performance.now() - started).toBeLessThan(200);
            expect(safe).toBe(expected);
        }
    });

    test("200 文字で切ったところが . や空白で終わったら、そこも削る", () => {
        expect(safeFileName("a".repeat(199) + " b")).toBe("a".repeat(199));
        expect(safeFileName("a".repeat(198) + ". b")).toBe("a".repeat(198));
    });

    test("fallback を変えられる。長い名前は切る。文字を壊さない", () => {
        expect(safeFileName("..", "upload")).toBe("upload");
        expect(safeFileName("a".repeat(500)).length).toBe(200);
        expect(Array.from(safeFileName("😀".repeat(500))).length).toBe(200);
        expect(safeFileName("😀".repeat(500))).not.toContain("\ufffd");
    });
});

describe("バンドル", () => {
    test("uploadLimit だけなら、Context が入らない", async () => {
        expect(await bundleOf("uploadLimit")).not.toContain("no_execution_ctx");
    });
});
