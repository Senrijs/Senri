import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

// "a;desc=\"x\";dur=1, b;dur=2" → [{ name, desc, dur }]
function parse(header: string | null) {
    return (header ?? "")
        .split(/,\s*(?=[\w-]+(?:;|$))/)
        .filter(Boolean)
        .map((entry) => {
            const [name, ...params] = entry.split(";");
            const get = (key: string) => params.find((p) => p.startsWith(`${key}=`))?.slice(key.length + 1);
            const desc = get("desc");
            return { name: name!.trim(), desc: desc ? JSON.parse(desc) : undefined, dur: Number(get("dur")) };
        });
}

function devApp() {
    const app = createApp({ dev: true });
    app.use(async function first(_c, next) {
        await next();
    });
    app.use(async (_c, next) => {
        await next();
    });
    app.get("/users/:id", () => "ok");
    return app;
}

describe("Server-Timing(開発モード)", () => {
    test("層ごとの時間を、外側から順に載せる", async () => {
        const res = await devApp().fetch(req("/users/1"));
        const entries = parse(res.headers.get("server-timing"));

        expect(entries.map((e) => e.name)).toEqual(["senri-1", "senri-2", "senri-handler", "senri-total"]);
        expect(entries[0]!.desc).toStartWith("1. first");
        expect(entries[1]!.desc).toStartWith("2. anonymous#2");
        expect(entries[2]!.desc).toStartWith("GET /users/:id");
        for (const e of entries) expect(e.dur).toBeGreaterThanOrEqual(0);
        // 外側の層ほど長い(内側を含む)
        expect(entries[0]!.dur).toBeGreaterThanOrEqual(entries[1]!.dur);
    });

    test("404 のときは notFound として載せる", async () => {
        const res = await devApp().fetch(req("/nope"));
        const names = parse(res.headers.get("server-timing")).map((e) => e.name);
        expect(names).toContain("senri-notFound");
    });

    test("アプリが付けた Server-Timing は残して、後ろに足す", async () => {
        const app = createApp({ dev: true });
        app.get("/db", (_, c) => {
            c.header("server-timing", 'db;desc="query";dur=12');
            return "ok";
        });
        app.get("/raw", () => new Response("ok", { headers: { "server-timing": "cache;desc=hit" } }));

        const db = (await app.fetch(req("/db"))).headers.get("server-timing")!;
        expect(db).toStartWith('db;desc="query";dur=12, senri-handler');
        const raw = (await app.fetch(req("/raw"))).headers.get("server-timing")!;
        expect(raw).toStartWith("cache;desc=hit, senri-handler");
    });

    test('名前に " や \\ があってもヘッダーが壊れない', async () => {
        const app = createApp({ dev: true });
        const mw = async (_c: unknown, next: () => Promise<Response>) => {
            await next();
        };
        Object.defineProperty(mw, "name", { value: 'we"ird\\name' });
        app.use(mw);
        app.get("/", () => "ok");

        const entries = parse((await app.fetch(req("/"))).headers.get("server-timing"));
        expect(entries[0]!.desc).toStartWith('1. we"ird\\name');
    });

    test("本番モードでは付けない", async () => {
        const app = createApp();
        app.use(async (_c, next) => {
            await next();
        });
        app.get("/", () => "ok");

        expect((await app.fetch(req("/"))).headers.get("server-timing")).toBeNull();
    });

    test("ダッシュボード(/_senri)には付けない", async () => {
        const app = createApp({ dev: true });
        const info = { remoteAddr: { hostname: "127.0.0.1" } };
        const res = await app.fetch(req("/_senri/api/requests", { headers: { host: "localhost" } }), info);
        expect(res.headers.get("server-timing")).toBeNull();
    });
});

describe("ASCII でない名前", () => {
    test("日本語の名前のミドルウェアやルートでも、レスポンスが返り、名前は %XX になる", async () => {
        const app = createApp({ dev: true });
        app.use(async function 認証(_c, next) {
            return next();
        });
        app.get("/ユーザー", () => "ok");
        const res = await app.fetch(req("/ユーザー"));
        expect(res.status).toBe(200);
        const header = res.headers.get("server-timing")!;
        expect(header).toContain(encodeURIComponent("認証"));
        expect(header).toContain(`GET /${encodeURIComponent("ユーザー")}`);
    });
});
