import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

    test("prefix の下だけで配る", async () => {
        const app = makeApp({ prefix: "/static" });
        expect(await (await app.fetch(req("/static/app.js"))).text()).toBe("console.log(1)");
        expect((await app.fetch(req("/app.js"))).status).toBe(404);
    });

    test("cacheControl を付けられる", async () => {
        const res = await makeApp({ cacheControl: "public, max-age=3600" }).fetch(req("/app.js"));
        expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
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
