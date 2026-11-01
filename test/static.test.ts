import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/index.ts";
import { serveStatic } from "../adapters/static/index.ts";

let dir: string;
let root: string;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "senri-static-"));
    root = join(dir, "public");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "index.html"), "<h1>home</h1>");
    await writeFile(join(root, "app.js"), "console.log(1)");
    await writeFile(join(root, "docs", "index.html"), "<h1>docs</h1>");
    await writeFile(join(root, ".env"), "SECRET=1");
    await writeFile(join(dir, "secret.txt"), "outside");
    await mkdir(join(root, "admin"));
    await writeFile(join(root, "admin", "secret.txt"), "admin-secret");
    // 8.3 の短い名前(DASHBO~1)が付くように、8文字より長い名前にする
    await mkdir(join(root, "dashboard-area"));
    await writeFile(join(root, "dashboard-area", "x.txt"), "dashboard-secret");
    await writeFile(join(root, "100%.txt"), "percent");
    await writeFile(join(root, "%2e%2e"), "literal");
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

function makeApp(options: Partial<Parameters<typeof serveStatic>[0]> = {}) {
    const app = createApp();
    app.use(serveStatic({ root, ...options }));
    app.get("/api", () => "api");
    return app;
}

describe("serveStatic()", () => {
    test("ファイルを Content-Type 付きで返す", async () => {
        const res = await makeApp().fetch(req("/app.js"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
        expect(res.headers.get("content-length")).toBe("14");
        expect(res.headers.get("etag")).toMatch(/^W\/".+"$/);
        expect(res.headers.get("last-modified")).not.toBeNull();
        expect(await res.text()).toBe("console.log(1)");
    });

    test("/ やディレクトリは index.html を返す", async () => {
        const app = makeApp();
        expect(await (await app.fetch(req("/"))).text()).toBe("<h1>home</h1>");
        expect(await (await app.fetch(req("/docs"))).text()).toBe("<h1>docs</h1>");
        expect(await (await app.fetch(req("/docs/"))).text()).toBe("<h1>docs</h1>");
    });

    test("index: false ならディレクトリは返さない", async () => {
        const res = await makeApp({ index: false }).fetch(req("/docs"));
        expect(res.status).toBe(404);
    });

    test("ファイルがなければ次(ルート)に回す", async () => {
        const app = makeApp();
        expect(await (await app.fetch(req("/api"))).text()).toBe("api");
        expect((await app.fetch(req("/missing.txt"))).status).toBe(404);
    });

    test("ETag が合えば 304", async () => {
        const app = makeApp();
        const first = await app.fetch(req("/app.js"));
        const etag = first.headers.get("etag")!;

        const res = await app.fetch(req("/app.js", { headers: { "if-none-match": etag } }));
        expect(res.status).toBe(304);
        expect(res.body).toBeNull();
        expect(res.headers.get("etag")).toBe(etag);
    });

    test("If-Modified-Since が新しければ 304", async () => {
        const app = makeApp();
        const first = await app.fetch(req("/app.js"));
        const lastModified = first.headers.get("last-modified")!;

        const res = await app.fetch(req("/app.js", { headers: { "if-modified-since": lastModified } }));
        expect(res.status).toBe(304);
    });

    test("HEAD はヘッダーだけ返す", async () => {
        const res = await makeApp().fetch(req("/app.js", { method: "HEAD" }));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-length")).toBe("14");
        expect(res.body).toBeNull();
    });

    test("GET / HEAD 以外は次に回す", async () => {
        const res = await makeApp().fetch(req("/app.js", { method: "POST" }));
        expect(res.status).toBe(404);
    });

    test(". で始まるファイルは返さない", async () => {
        const res = await makeApp().fetch(req("/.env"));
        expect(res.status).toBe(404);
    });

    test("root の外は返さない", async () => {
        const app = makeApp();
        // "%2e%2e" は URL の段階で ".." として解決され、/secret.txt(root の中にはない)になる
        expect((await app.fetch(req("/%2e%2e/secret.txt"))).status).toBe(404);
        // バックスラッシュ(Windows の区切り)を使っても出られない
        expect((await app.fetch(req("/..%5csecret.txt"))).status).toBe(404);
        expect((await app.fetch(req("/docs%5c..%5c..%5csecret.txt"))).status).toBe(404);
    });

    test("root の外を指すシンボリックリンクはたどらない", async () => {
        try {
            await symlink(join(dir, "secret.txt"), join(root, "link.txt"));
        } catch {
            // Windows では権限がないとシンボリックリンクを作れない
            return;
        }
        const res = await makeApp().fetch(req("/link.txt"));
        expect(res.status).toBe(404);
    });

    test("root の中のシンボリックリンクがドットファイルを指していても配らない", async () => {
        try {
            await symlink(join(root, ".env"), join(root, "config.txt"));
        } catch {
            // Windows では権限がないとシンボリックリンクを作れない
            return;
        }
        expect((await makeApp().fetch(req("/config.txt"))).status).toBe(404);
        expect(await (await makeApp({ dotfiles: true }).fetch(req("/config.txt"))).text()).toBe("SECRET=1");
    });

    test("prefix の下だけで配る", async () => {
        const app = makeApp({ prefix: "/static" });
        expect(await (await app.fetch(req("/static/app.js"))).text()).toBe("console.log(1)");
        expect((await app.fetch(req("/app.js"))).status).toBe(404);
    });

    test("cacheControl を付けられる", async () => {
        const res = await makeApp({ cacheControl: "public, max-age=3600" }).fetch(req("/app.js"));
        expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    test("エンコードされたパスでも root の外は返さず、500 にもならない", async () => {
        const app = makeApp();
        const cases: [path: string, status: number][] = [
            // . / .. は URL の段階で解決されるか、ルーターが 400 にする
            ["/%2e%2e/secret.txt", 404],
            ["/%2E%2E/secret.txt", 404],
            ["/%2e./secret.txt", 404],
            ["/.%2e/secret.txt", 404],
            ["/..%2fsecret.txt", 400],
            ["/docs/..%2f..%2fsecret.txt", 400],
            ["/%2fapp.js", 400],
            // 二重エンコードは、もう一度デコードしない
            ["/%252e%252e/secret.txt", 404],
            ["/%252e%252e%252fsecret.txt", 404],
            // NUL・バックスラッシュ・ドライブ・\\?\・NTFS のストリーム・デバイス名
            ["/app.js%00", 404],
            ["/%00", 404],
            ["/docs%5c..%5c..%5csecret.txt", 404],
            ["/C:/Windows/win.ini", 404],
            ["/C%3a/Windows/win.ini", 404],
            ["/%5c%5c%3f%5cC:%5cWindows%5cwin.ini", 404],
            ["/app.js::$DATA", 404],
            ["/NUL", 404],
            // 不正なエンコードは 400
            ["/%", 400],
            ["/%zz", 400],
            ["/app%zz.js", 400],
            ["/%e3%81", 400],
            ["/%c0%ae%c0%ae/secret.txt", 400],
            ["/%ed%a0%80", 400],
        ];
        for (const [path, status] of cases) {
            const res = await app.fetch(req(path));
            expect({ path, status: res.status }).toEqual({ path, status });
            expect(await res.text()).not.toContain("outside");
        }
    });

    test("デコードは1回だけ(デコード後に残った % は、ファイル名の文字)", async () => {
        const app = makeApp();
        expect(await (await app.fetch(req("/100%25.txt"))).text()).toBe("percent");
        expect((await app.fetch(req("/100%2525.txt"))).status).toBe(404);
        expect(await (await app.fetch(req("/%252e%252e"))).text()).toBe("literal");
    });

    test("Cloudflare Workers では、分かりやすいエラーにする", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
        try {
            expect(() => serveStatic({ root })).toThrow("Static Assets");
        } finally {
            if (original) Object.defineProperty(globalThis, "navigator", original);
        }
    });
});

// Windows と macOS は、綴りが違っても同じファイルを開く。app.use(path, ...) は綴りどおりにしか当たらないので、
// 綴りが違えば配らないことで、ミドルウェアを飛ばせないようにしている(Linux では、もともと別のファイル)
describe("serveStatic() は、綴りがディスク上の名前と同じときだけ配る", () => {
    const looseOs = process.platform === "win32" || process.platform === "darwin";

    function guarded() {
        const app = createApp();
        app.use("/admin", () => new Response("auth", { status: 401 }));
        app.use("/dashboard-area", () => new Response("auth", { status: 401 }));
        app.use(serveStatic({ root }));
        return app;
    }

    // 前提: CI の Windows / macOS は、大文字小文字を区別しない。区別するなら、下のテストは何も確かめていない
    test.if(looseOs)("前提: このファイルシステムは、大文字小文字を区別しない", () => {
        expect(existsSync(join(root, "ADMIN", "SECRET.TXT"))).toBe(true);
    });

    test("prefix 付きのミドルウェアは、綴りどおりに動く", async () => {
        const app = guarded();
        expect((await app.fetch(req("/admin/secret.txt"))).status).toBe(401);
        expect((await app.fetch(req("/%61dmin/secret.txt"))).status).toBe(401);
    });

    test("大文字小文字が違えば配らない(ミドルウェアを飛ばせない)", async () => {
        const app = guarded();
        for (const path of ["/ADMIN/secret.txt", "/Admin/secret.txt", "/%41dmin/secret.txt"]) {
            expect({ path, status: (await app.fetch(req(path))).status }).toEqual({ path, status: 404 });
        }
        // ミドルウェアがなくても同じ(Linux と同じ挙動)
        for (const path of ["/APP.JS", "/admin/SECRET.TXT"]) {
            expect({ path, status: (await makeApp().fetch(req(path))).status }).toEqual({ path, status: 404 });
        }
    });

    test("8.3 の短い名前や、末尾の . と空白では配らない", async () => {
        const app = guarded();
        for (const path of ["/DASHBO~1/x.txt", "/dashbo~1/x.txt", "/admin./secret.txt", "/app.js.", "/app.js%20"]) {
            expect({ path, status: (await app.fetch(req(path))).status }).toEqual({ path, status: 404 });
        }
    });

    test("ディレクトリの index も、綴りどおりに確かめる", async () => {
        expect(await (await makeApp().fetch(req("/docs"))).text()).toBe("<h1>docs</h1>");
        expect((await makeApp({ index: "INDEX.HTML" }).fetch(req("/docs"))).status).toBe(404);
    });

    test("ファイルを足したり名前を変えたりしたら、すぐ反映する(名前の一覧を使い回さない)", async () => {
        const app = makeApp();
        await mkdir(join(root, "cache"));
        await writeFile(join(root, "cache", "Case.txt"), "case");
        expect(await (await app.fetch(req("/cache/Case.txt"))).text()).toBe("case");

        await writeFile(join(root, "cache", "new.txt"), "new");
        expect(await (await app.fetch(req("/cache/new.txt"))).text()).toBe("new");

        await rename(join(root, "cache", "Case.txt"), join(root, "cache", "case.txt"));
        expect(await (await app.fetch(req("/cache/case.txt"))).text()).toBe("case");
        expect((await app.fetch(req("/cache/Case.txt"))).status).toBe(404);
    });

    // 同じ時計の刻みのうちに続けて名前を変えると、ディレクトリの mtime が変わらないことがある(CI の Windows で起きた)
    // mtime で一覧を使い回すと、古い綴りが通ってしまう。偶然に頼らず再現するため、名前を変えるたびに mtime を同じ値に戻す
    // (大文字小文字だけの名前の変更で同じファイルのままになるのは Windows / macOS)
    test.if(looseOs)("大文字小文字だけの名前の変更を続けても、毎回いまの綴りでだけ配る", async () => {
        const app = makeApp();
        const swap = join(root, "swap");
        const frozen = new Date("2020-01-01T00:00:00Z");
        await mkdir(swap);
        await writeFile(join(swap, "Case.txt"), "swap");
        await utimes(swap, frozen, frozen);
        let current = "Case.txt";
        for (let i = 0; i < 30; i++) {
            const other = current === "Case.txt" ? "case.txt" : "Case.txt";
            await rename(join(swap, current), join(swap, other));
            await utimes(swap, frozen, frozen);
            current = other;
            const stale = current === "Case.txt" ? "case.txt" : "Case.txt";
            // 本文は読み切る(開いたままだと、Windows では次の名前の変更を邪魔する)
            const hit = await app.fetch(req(`/swap/${current}`));
            expect({ i, path: current, status: hit.status, body: await hit.text() }).toEqual({ i, path: current, status: 200, body: "swap" });
            const miss = await app.fetch(req(`/swap/${stale}`));
            expect({ i, path: stale, status: miss.status }).toEqual({ i, path: stale, status: 404 });
            await miss.body?.cancel();
        }
    });
});
