// ドキュメントの「本番」と「開発モード」の章に書いた動き
import { expect } from "bun:test";
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { upgradeWebSocket } from "../../src/websocket.ts";
import { metrics, metricsHandler, resetMetrics } from "../../src/metrics.ts";
import { contextStorage, getContext, tryGetContext } from "../../adapters/context-storage/index.ts";
import { serve } from "../../adapters/serve/index.ts";
import { setDraining } from "../../src/health.ts";
import { claim, ipInfo, quiet, req } from "./claim.ts";

// ---------- production/serve ----------
claim("production/serve#bad-port", "PORT が数字でないときは、エラーにする", async () => {
    const proc = Bun.spawn(["bun", "-e", `import { createApp } from "./src/index.ts"; import { serve } from "./adapters/serve/index.ts"; try { await serve(createApp(), { banner: false }); console.log("listening"); process.exit(0); } catch (e) { console.log(e.message); }`], {
        cwd: `${import.meta.dir}/../..`,
        stdout: "pipe",
        env: { ...process.env, PORT: "abc" },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out).toContain("The PORT environment variable must be a port number (0-65535): abc");
}, 30_000);
claim("production/serve#server", "server.url・server.port・server.stop()", async () => {
    const app = createApp();
    app.get("/", () => "x");
    const server = await serve(app, { port: 0, hostname: "127.0.0.1", banner: false, gracefulShutdown: false });
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(await (await fetch(server.url)).text()).toBe("x");
    await server.stop();
    // stop() は /readyz を 503 にする(止まり始めた状態)。同じプロセスのほかのテストに残さない
    setDraining(false);
});

// ---------- production/websocket ----------
{
    const app = createApp();
    app.get("/chat", upgradeWebSocket(() => ({})));
    claim("production/websocket#426", "Upgrade: websocket のないリクエストは 426", async () => {
        expect((await quiet(() => req(app, "GET", "/chat"))).status).toBe(426);
    });
    claim("production/websocket#cross-origin", "よそのサイトのページからの接続は 403", async () => {
        const r = await quiet(() =>
            req(app, "GET", "/chat", {
                headers: { upgrade: "websocket", connection: "Upgrade", origin: "https://evil.example", host: "localhost", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" },
            }),
        );
        expect(r.status).toBe(403);
    });
}

// ---------- production/context-storage ----------
claim("production/context-storage#after-await", "await のあとでも、いまのリクエストの c が取れる", async () => {
    const app = createApp();
    app.use(contextStorage());
    app.get("/me", async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getContext().req.headers.get("x-user") ?? "anonymous";
    });
    expect(await (await req(app, "GET", "/me", { headers: { "x-user": "alice" } })).text()).toBe("alice");
});
claim("production/context-storage#outside", "リクエストの外では、getContext() は no_context の例外、tryGetContext() は undefined", () => {
    let code = "";
    try {
        getContext();
    } catch (e) {
        code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("no_context");
    expect(tryGetContext()).toBeUndefined();
});

// ---------- production/metrics ----------
claim("production/metrics#names", "route はパターン、ルートがなければ unmatched。2 つのメトリクス", async () => {
    resetMetrics();
    const app = createApp();
    app.use(metrics());
    app.get("/users/:id", () => "u");
    app.get("/metrics", metricsHandler());
    await req(app, "GET", "/users/42");
    await req(app, "GET", "/none");
    const text = await (await req(app, "GET", "/metrics")).text();
    expect(text).toMatch(/http_server_request_duration_seconds_count\{[^}]*route="\/users\/:id"/);
    expect(text).toContain('route="unmatched"');
    expect(text).toContain("http_server_active_requests");
});

// ---------- dev ----------
{
    const app = createApp({ dev: devtools({ lang: "ja" }) });
    app.use(async function auth(_, next) {
        await next();
    });
    app.get("/todos", () => []);
    app.get("/boom", () => {
        throw new Error("しまった");
    });
    app.post("/only-post", () => "x");
    claim("dev/error-pages#text", "curl などには、テキストでエラーの文", async () => {
        const r = await quiet(() => req(app, "GET", "/boom"));
        expect(r.status).toBe(500);
        expect(await r.text()).toContain("しまった");
    });
    claim("dev/error-pages#html", "ブラウザから開いたときだけエラーページ(HTML)", async () => {
        const r = await quiet(() => req(app, "GET", "/boom", { headers: { accept: "text/html" } }));
        expect(r.headers.get("content-type")).toStartWith("text/html");
    });
    claim("dev/error-pages#did-you-mean", "/todo なら GET /todos と、\"s\" が1文字足りません", async () => {
        const html = await (await req(app, "GET", "/todo", { headers: { accept: "text/html" } })).text();
        expect(html).toContain('"suggestion":{"method":"GET","path":"/todos"');
        expect(html).toContain("が1文字足りません");
    });
    claim("dev/error-pages#within-3", "3 文字以内しか違わないパスだけ提案する", async () => {
        expect(await (await req(app, "GET", "/xodo")).text()).toContain("GET /todos");
        expect(await (await req(app, "GET", "/zzzzzzzz")).text()).not.toContain("もしかして");
    });
    claim("dev/error-pages#not-on-c-not-found", "c.notFound() で回した 404 には出さない", async () => {
        const a = createApp({ dev: devtools({ lang: "ja" }) });
        a.get("/todos", () => []);
        a.get("/todos/:id", (_, c) => c.notFound());
        expect(await (await req(a, "GET", "/todos/1")).text()).not.toContain("もしかして");
    });
    claim("dev/error-pages#405", "405 のときは、どのメソッドならあるかを出す", async () => {
        const r = await req(app, "GET", "/only-post");
        expect(r.status).toBe(405);
        expect(await r.text()).toContain("POST");
    });
    claim("dev/dashboard#local-only", "同じ PC(接続元と Host が localhost)からだけ開ける。それ以外はふつうの 404", async () => {
        expect((await req(app, "GET", "/_senri", { headers: { host: "localhost:3927" } })).status).toBe(200);
        expect((await req(app, "GET", "/_senri", { info: ipInfo("192.168.0.2"), headers: { host: "localhost:3927" } })).status).toBe(404);
        expect((await req(app, "GET", "/_senri", { headers: { host: "evil.example" } })).status).toBe(404);
    });
    claim("dev/dashboard#needs-info", "接続元が app.fetch に渡らないと開けない", async () => {
        expect((await app.fetch(new Request("http://localhost/_senri", { headers: { host: "localhost" } }))).status).toBe(404);
    });
    claim("dev/server-timing#header", "Server-Timing は senri- で始まり、ミドルウェアには self が入る", async () => {
        const st = (await req(app, "GET", "/todos")).headers.get("server-timing")!;
        expect(st).toMatch(/^senri-1;desc="1\. auth \(self [\d.]+ms\)";dur=[\d.]+, senri-handler;desc="GET \/todos";dur=[\d.]+, senri-total;desc="total";dur=[\d.]+$/);
    });
    claim("dev/server-timing#keep-app-header", "アプリが付けた Server-Timing は残して、後ろにつなぐ", async () => {
        const a = createApp({ dev: devtools() });
        a.get("/", (_, c) => (c.header("server-timing", "db;dur=1"), "x"));
        expect((await req(a, "GET", "/")).headers.get("server-timing")).toStartWith("db;dur=1, senri-");
    });
    claim("dev/devtools#local-only", "NODE_ENV が未設定なら、localhost へのリクエストにだけ出す(test なら全部)", async () => {
        // bun test は NODE_ENV=test を入れるので、外してから作る
        const before = process.env.NODE_ENV;
        delete process.env.NODE_ENV;
        let unset: ReturnType<typeof createApp>;
        try {
            unset = createApp({ dev: devtools({ lang: "ja" }) });
        } finally {
            process.env.NODE_ENV = before;
        }
        unset.get("/todos", () => []);
        unset.get("/boom", () => {
            throw new Error("しまった");
        });
        expect((await quiet(() => req(unset, "GET", "/todos", { info: ipInfo("192.168.0.2") }))).headers.get("server-timing")).toBeNull();
        expect(await (await quiet(() => req(unset, "GET", "/boom", { info: ipInfo("192.168.0.2") }))).text()).toBe("500 Internal Server Error");
        expect((await req(unset, "GET", "/todos")).headers.get("server-timing")).toContain("senri-total");
        // NODE_ENV=test(bun test)では、全部のリクエストに出す
        expect((await quiet(() => req(app, "GET", "/todos", { info: ipInfo("192.168.0.2") }))).headers.get("server-timing")).toContain("senri-total");
    });
    claim("dev/devtools#lang", "lang が \"ja\" か \"en\" でなければ TypeError", () => {
        expect(() => devtools({ lang: "fr" as never })).toThrow(TypeError);
    });
}
