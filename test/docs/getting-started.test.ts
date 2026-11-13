// ドキュメントの「はじめに」の章(Senri とは・インストール・最初のアプリ・ランタイムごとの動かし方)に書いた動き
import { expect } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { serve } from "../../adapters/serve/index.ts";
import { SERVE_MESSAGES } from "../../adapters/serve/messages.ts";
import { setDraining } from "../../src/health.ts";
import { claim, quiet, req } from "./claim.ts";

const ROOT = join(import.meta.dir, "../..");

// ---------- index ----------
{
    const app = createApp();
    app.get("/hello", () => "こんにちは");
    app.get("/users/:id", ({ id }) => ({ id }));
    claim("index#string-text", "文字列は text/plain", async () => {
        const r = await req(app, "GET", "/hello");
        expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(await r.text()).toBe("こんにちは");
    });
    claim("index#object-json", "オブジェクトは JSON", async () => {
        const r = await req(app, "GET", "/users/1");
        expect(r.headers.get("content-type")).toStartWith("application/json");
        expect(await r.json()).toEqual({ id: "1" });
    });
}

// ---------- getting-started/installation ----------
claim("getting-started/installation#next-steps", "作り終わると、動かすコマンドを表示する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "senri-create-"));
    const proc = Bun.spawn(["node", join(ROOT, "packages/create-senri/index.js"), "my-app", "--template", "bun"], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, npm_config_user_agent: "npm/11" } });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out).toContain("cd my-app");
    expect(out).toContain("npm install");
    expect(out).toContain("npm run dev   # → http://localhost:3927");
    expect(readdirSync(join(dir, "my-app")).sort()).toEqual([".gitignore", "README.md", "package.json", "src", "tsconfig.json"]);
    expect(readdirSync(join(dir, "my-app", "src"))).toEqual(["index.ts"]);
}, 30_000);

// ---------- getting-started/first-app ----------
{
    const firstApp = (dev = true) => {
        const app = createApp(dev ? { dev: devtools({ lang: "ja" }) } : {});
        app.get("/", () => "Hello, Senri!");
        app.get("/users/:id", ({ id }) => ({ id }));
        app.get("/hello/:name", ({ name }) => `こんにちは、${name} さん`);
        app.get("/todos", () => [{ id: 1, title: "牛乳を買う", done: false }]);
        app.get("/boom", () => {
            throw new Error("しまった");
        });
        return app;
    };
    claim("getting-started/first-app#banner", "起動すると、URL と登録されているルートを表示する", async () => {
        const lines: string[] = [];
        const { log } = console;
        console.log = (...args: unknown[]) => void lines.push(args.join(" "));
        try {
            const server = await serve(firstApp(), { port: 0, lang: "ja" });
            await server.stop();
            setDraining(false);
        } finally {
            console.log = log;
        }
        const text = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        expect(text).toContain("ready");
        expect(text).toMatch(/GET\s+\/users\/:id/);
        // 環境変数 PORT も port オプションもないときの表示
        expect(SERVE_MESSAGES.ja.default).toBe("デフォルト。環境変数 PORT で変えられます");
    });
    claim("getting-started/first-app#hello", "文字列を返すルート(text/plain)", async () => {
        const r = await req(firstApp(), "GET", "/hello/senri");
        expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(await r.text()).toBe("こんにちは、senri さん");
    });
    claim("getting-started/first-app#todos", "配列を返すと JSON", async () => {
        const r = await req(firstApp(), "GET", "/todos");
        expect(r.headers.get("content-type")).toStartWith("application/json");
        expect(await r.text()).toBe('[{"id":1,"title":"牛乳を買う","done":false}]');
    });
    claim("getting-started/first-app#error-page", "開発モードでは、エラーの文が出る", async () => {
        const r = await quiet(() => req(firstApp(), "GET", "/boom", { headers: { accept: "text/html" } }));
        expect(r.status).toBe(500);
        expect(await r.text()).toContain("しまった");
    });
    claim("getting-started/first-app#production-500", "本番では 500 Internal Server Error とだけ返す", async () => {
        const r = await quiet(() => req(firstApp(false), "GET", "/boom"));
        expect(r.status).toBe(500);
        expect(await r.text()).toBe("500 Internal Server Error");
    });
    claim("getting-started/first-app#did-you-mean", '/todo を開くと「もしかして: GET /todos」と "s" が1文字足りません', async () => {
        const r = await req(firstApp(), "GET", "/todo", { headers: { accept: "text/html", "accept-language": "ja" } });
        const html = await r.text();
        expect(r.status).toBe(404);
        expect(html).toContain('"suggestion":{"method":"GET","path":"/todos"');
        expect(html).toContain("が1文字足りません");
    });
    claim("getting-started/first-app#no-suggestion-without-todos", "雛形のルートだけのときは、提案しない", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.get("/", () => "Hello, Senri!");
        app.get("/users/:id", ({ id }) => ({ id }));
        const html = await (await req(app, "GET", "/todo", { headers: { accept: "text/html" } })).text();
        expect(html).toContain('"suggestion":null');
    });
    claim("getting-started/first-app#did-you-mean-en", "ブラウザの言語が英語なら did you mean:", async () => {
        const app = createApp({ dev: devtools() });
        app.get("/todos", () => []);
        const html = await (await req(app, "GET", "/todo", { headers: { accept: "text/html", "accept-language": "en" } })).text();
        expect(html).toContain('"lang":"en"');
        expect(html).toContain('"suggestion":{"method":"GET","path":"/todos"');
    });
    claim("getting-started/first-app#dashboard", "/_senri でダッシュボードが開く", async () => {
        const r = await req(firstApp(), "GET", "/_senri", { headers: { host: "localhost:3927" } });
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toStartWith("text/html");
    });
    claim("getting-started/first-app#production-off", "NODE_ENV=production では devtools() は何もしない", () => {
        const before = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
            expect(devtools()).toBeUndefined();
        } finally {
            process.env.NODE_ENV = before;
        }
    });
}

// ---------- runtimes/browser ----------
claim("runtimes/browser#app-fetch", "ページの中で app.fetch を呼ぶ", async () => {
    const app = createApp();
    app.get("/api/todos/:id", ({ id }) => ({ id, done: false }));
    const res = await app.fetch(new Request("http://localhost/api/todos/1"));
    expect(await res.json()).toEqual({ id: "1", done: false });
});

// ---------- runtimes/deno ----------
claim("runtimes/deno#permissions", "許可がなければ PORT は 3927、devtools() は 1 行の案内を出して動かない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "senri-deno-"));
    const file = join(dir, "main.ts");
    const src = (p: string) => JSON.stringify(pathToFileURL(join(ROOT, p)).href);
    await Bun.write(
        file,
        `import { createApp } from ${src("src/index.ts")};
import { devtools } from ${src("src/dev/index.ts")};
import { serve } from ${src("adapters/serve/index.ts")};
const app = createApp({ dev: devtools({ lang: "ja" }) });
app.get("/", () => "x");
const s = await serve(app, { banner: false, gracefulShutdown: false });
console.log("PORT=" + s.port);
const r = await fetch(s.url + "/zz");
console.log("BODY=" + (await r.text()));
await s.stop();
`,
    );
    const proc = Bun.spawn(["deno", "run", "--allow-net", "--allow-read", file], { stdout: "pipe", stderr: "pipe", env: { ...process.env, PORT: "4000" } });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    const all = out + err;
    expect(all).toContain("PORT=3927");
    expect(all).toContain("--allow-env=NODE_ENV");
    expect(all).toContain("BODY=404 Not Found");
}, 60_000);
