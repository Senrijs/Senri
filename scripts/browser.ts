// ブラウザ(Chromium)で Senri が動くかを確かめる。使い方: node scripts/browser.ts
// 1. test/browser/ のページ用と Service Worker 用のスクリプトを bun build でバンドルする
// 2. 小さな静的サーバー(localhost)で配って、Playwright の Chromium で開く
// 3. ページで app.fetch() を、Service Worker で fetch イベントへの返事を確かめる
// どちらも、ページのエラー・コンソールのエラーが0件であること
// Chromium は先に入れておく: npx playwright install chromium(CI では --with-deps 付き)
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../src/index.ts";
import { deleteCookie, setCookie } from "../src/cookie.ts";
import { serve as serveNode } from "../adapters/node/index.ts";

const ROOT = join(import.meta.dirname, "..");
// Service Worker の登録と切り替えを待つ上限(ミリ秒)
const SW_TIMEOUT = 10_000;

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

// --- 1. バンドル ---
const out = await mkdtemp(join(tmpdir(), "senri-browser-"));
for (const [entry, name] of [
    ["test/browser/page.ts", "page.js"],
    ["test/browser/sw.ts", "sw.js"],
]) {
    const built = spawnSync("bun", ["build", join(ROOT, entry!), "--target", "browser", "--outfile", join(out, name!)], {
        encoding: "utf8",
    });
    if (built.status !== 0) throw new Error(`${entry} をバンドルできませんでした\n${built.stderr}`);
}

// --- 2. 静的サーバー。/api/ は 404(Service Worker が答えないと、ここに来て 404 になる) ---
const PAGE = `<!doctype html><meta charset="utf-8"><title>senri</title><script type="module" src="/page.js"></script>`;
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8" };
const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
        res.writeHead(200, { "content-type": TYPES[".html"] });
        return res.end(PAGE);
    }
    // ブラウザが勝手に取りに来る。404 にするとコンソールにエラーが出るので
    if (path === "/favicon.ico") {
        res.writeHead(204);
        return res.end();
    }
    if (path === "/page.js" || path === "/sw.js") {
        res.writeHead(200, { "content-type": TYPES[extname(path)]! });
        return res.end(await readFile(join(out, path.slice(1))));
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("static 404");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://localhost:${typeof address === "object" && address ? address.port : 0}`;

// --- 3. Chromium ---
const browser = await chromium.launch();
const errors: string[] = [];
try {
    const context = await browser.newContext();
    // Service Worker の中のエラーも拾う(起動したときにリスナーを付ける)
    context.on("serviceworker", (worker) => {
        worker.on("console", (msg) => msg.type() === "error" && errors.push(`sw console.error: ${msg.text()}`));
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    // わざと 404 を返させている URL(/nope と /api/nope)の「Failed to load resource」だけは数えない
    const expected404 = (url: string) => /\/(api\/)?nope$/.test(url);
    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        if (msg.text().startsWith("Failed to load resource") && expected404(msg.location().url)) return;
        errors.push(`console.error: ${msg.text()} (${msg.location().url})`);
    });
    await page.goto(base);

    // ページで app.fetch()
    const inPage = await page.evaluate(async () => {
        const app = (globalThis as unknown as { senri: { fetch(req: Request): Promise<Response> } }).senri;
        const call = async (path: string, init?: RequestInit) => {
            const res = await app.fetch(new Request(`http://app${path}`, init));
            return {
                status: res.status,
                type: res.headers.get("content-type"),
                mark: res.headers.get("x-senri"),
                body: await res.text(),
            };
        };
        return {
            text: await call("/api/hello"),
            params: await call("/api/users/42"),
            post: await call("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: `{"a":1}` }),
            bytes: await call("/api/bytes"),
            missing: await call("/nope"),
        };
    });
    check("ページ: 文字列 → text/plain", inPage.text.body === "こんにちは" && inPage.text.type === "text/plain; charset=utf-8", JSON.stringify(inPage.text));
    check("ページ: パラメーター → JSON", inPage.params.body === `{"id":"42","from":"senri"}` && inPage.params.type === "application/json", JSON.stringify(inPage.params));
    check("ページ: ボディを読む", inPage.post.body === `{"body":{"a":1}}`, JSON.stringify(inPage.post));
    check("ページ: Uint8Array → そのままボディ", inPage.bytes.body === "\u0001\u0002\u0003", JSON.stringify(inPage.bytes));
    check("ページ: ミドルウェア", inPage.text.mark === "browser", JSON.stringify(inPage.text));
    check("ページ: 404", inPage.missing.status === 404 && inPage.missing.body === "404 Not Found", JSON.stringify(inPage.missing));

    // Service Worker で fetch イベントに答える
    // 登録や切り替えが終わらないときに永遠に待たないよう、待ちには上限を付ける(どちらで止まったかを出して失敗にする)
    const viaWorker = await page.evaluate(async (limit) => {
        const within = <T>(promise: Promise<T>, label: string) =>
            Promise.race([
                promise,
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} を ${limit}ms 待っても終わらなかった`)), limit)),
            ]);
        await navigator.serviceWorker.register("/sw.js");
        await within(navigator.serviceWorker.ready, "navigator.serviceWorker.ready");
        // このページを Service Worker が受け持つまで待つ(clients.claim())
        if (!navigator.serviceWorker.controller) {
            await within(
                new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })),
                "controllerchange(clients.claim() で、このページを受け持つ)",
            );
        }
        const res = await fetch("/api/users/7");
        const post = await fetch("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: `{"b":2}` });
        const missing = await fetch("/api/nope");
        return {
            status: res.status,
            mark: res.headers.get("x-senri"),
            body: await res.text(),
            post: await post.text(),
            missing: { status: missing.status, body: await missing.text() },
        };
    }, SW_TIMEOUT).catch((err: Error) => {
        // 時間切れ(ほかの失敗も)は、ここで1件の失敗にして、残りの確認は飛ばす
        check("Service Worker: 登録と切り替え", false, err.message.split("\n")[0]!);
        return null;
    });
    if (viaWorker) {
        check("Service Worker: パラメーター → JSON", viaWorker.body === `{"id":"7","from":"senri"}`, JSON.stringify(viaWorker));
        check("Service Worker: ミドルウェア", viaWorker.mark === "browser", JSON.stringify(viaWorker));
        check("Service Worker: ボディを読む", viaWorker.post === `{"body":{"b":2}}`, viaWorker.post);
        // 静的サーバーの 404("static 404")ではなく、Senri の 404 が返る
        check("Service Worker: Senri の 404", viaWorker.missing.status === 404 && viaWorker.missing.body === "404 Not Found", JSON.stringify(viaWorker.missing));
    }

    // Cookie: 本物の HTTP のレスポンス(Set-Cookie)で付けて、deleteCookie で消えるか
    // __Host- / __Secure- は Secure のない Set-Cookie をブラウザが捨てるので、消すときにも Secure が要る
    // (Chromium は http://localhost を安全なオリジンとして扱うので、Secure の Cookie も付けられる)
    const cookieApp = createApp();
    const NAMES = ["__Host-id", "__Secure-id", "plain"];
    cookieApp.get("/set", (_, c) => {
        for (const name of NAMES) setCookie(c, name, "1");
        return "set";
    });
    cookieApp.get("/delete", (_, c) => {
        for (const name of NAMES) deleteCookie(c, name);
        return "deleted";
    });
    const cookieServer = serveNode(cookieApp, { port: 0 });
    try {
        await new Promise<void>((resolve) => cookieServer.once("listening", resolve));
        const cookieAddress = cookieServer.address();
        const cookieBase = `http://localhost:${typeof cookieAddress === "object" && cookieAddress ? cookieAddress.port : 0}`;
        const names = async () => (await context.cookies(cookieBase)).map((c) => c.name).sort();
        await page.goto(`${cookieBase}/set`);
        const afterSet = await names();
        check("Cookie: setCookie で付く", JSON.stringify(afterSet) === JSON.stringify([...NAMES].sort()), JSON.stringify(afterSet));
        await page.goto(`${cookieBase}/delete`);
        const afterDelete = await names();
        check("Cookie: deleteCookie で消える(__Host- / __Secure- も)", afterDelete.length === 0, JSON.stringify(afterDelete));
    } finally {
        cookieServer.close();
    }
} finally {
    await browser.close();
    server.close();
    await rm(out, { recursive: true, force: true });
}
check("ページのエラー・コンソールのエラーが0件", errors.length === 0, errors.join("\n"));

let ok = true;
for (const r of results) {
    if (!r.ok) ok = false;
    console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n       ${r.detail}`}`);
}
process.exitCode = ok ? 0 : 1;
