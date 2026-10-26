import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/index.ts";
import { dashboardOf } from "../../src/dev/index.ts";
import type { DashboardPageData } from "../../src/dev/page-data.ts";

// localhost からのアクセス(Bun の server を真似る)
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
const remote = { requestIP: () => ({ address: "192.168.1.10", family: "IPv4", port: 1 }) };
const req = (path: string, init: RequestInit = {}, host = "localhost:3927") =>
    new Request(`http://${host}${path}`, { ...init, headers: { host, ...(init.headers as Record<string, string>) } });

function app(options = { dev: true }) {
    const a = createApp(options);
    a.use(async function logger(c, next) {
        await next();
        c.header("x-from-logger", "1");
    });
    a.use("/admin", function auth(c) {
        c.status(401);
        return "ログインしてね";
    });
    a.get("/hello", () => "hi");
    a.get("/admin/users/:id", () => "x");
    a.get("/boom", () => {
        throw new Error("わざと壊した");
    });
    return a;
}

async function pageData(res: Response): Promise<DashboardPageData> {
    const m = /id="senri-data">([\s\S]*?)<\/script>/.exec(await res.text());
    return JSON.parse(m![1]!);
}

describe("/_senri を開ける条件", () => {
    test("開発モードで、localhost から開くとダッシュボード", async () => {
        const res = await app().fetch(req("/_senri"), local);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect((await pageData(res)).kind).toBe("dashboard");
    });

    test("localhost 以外・Host の偽装・接続元不明は、普通の処理に回る(/_senri はないので 404)", async () => {
        const a = app();
        const cases: [Request, unknown][] = [
            [req("/_senri/api/requests"), remote],
            [req("/_senri/api/requests", {}, "evil.example:3927"), local],
            [req("/_senri/api/requests"), undefined],
            [req("/_senri/api/requests"), { MY_KV: {} }],
        ];
        for (const [r, info] of cases) {
            const res = await a.fetch(r, info);
            expect(res.status).toBe(404);
            expect(await res.text()).not.toContain('"requests"');
        }
    });

    test("本番では /_senri は存在しない(普通の 404)", async () => {
        const res = await app({ dev: false }).fetch(req("/_senri"), local);

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("404 Not Found");
    });

    test("開発モードで /_senri から始まるルートを登録するとエラー(ダッシュボードに隠れて呼ばれないので)", () => {
        expect(() => app().get("/_senri/x", () => "x")).toThrow("/_senri");
        // 本番では登録できる
        expect(() => app({ dev: false }).get("/_senri/x", () => "x")).not.toThrow();
    });
});

describe("/_senri へのリクエスト", () => {
    test("記録しない", async () => {
        const a = app();
        await a.fetch(req("/hello"), local);

        await a.fetch(req("/_senri"), local);
        await a.fetch(req("/_senri/api/requests"), local);

        expect((await dashboardOf(a))!.log.size).toBe(1);
    });

    test("利用者のミドルウェアは通らない", async () => {
        const res = await app().fetch(req("/_senri/api/requests"), local);

        expect(res.headers.get("x-from-logger")).toBeNull();
    });
});

describe("API", () => {
    test("一覧は新しい順の要約、詳細は id で取れる", async () => {
        const a = app();
        await a.fetch(req("/hello"), local);
        await a.fetch(req("/boom"), local);

        const list = (await (await a.fetch(req("/_senri/api/requests"), local)).json()) as { id: string; path: string; hasError: boolean }[];
        expect(list.map((r) => [r.path, r.hasError])).toEqual([
            ["/boom", true],
            ["/hello", false],
        ]);

        const detail = await (await a.fetch(req(`/_senri/api/requests/${list[0]!.id}`), local)).json();
        expect(detail).toMatchObject({ path: "/boom", status: 500 });
        expect((await a.fetch(req("/_senri/api/requests/999"), local)).status).toBe(404);
    });

    test("500 のリクエストは、エラーページを HTML で見られる", async () => {
        const a = app();
        await a.fetch(req("/boom"), local);
        const [first] = (await dashboardOf(a))!.log.list();

        const res = await a.fetch(req(`/_senri/api/requests/${first!.id}/error`), local);

        expect(res.status).toBe(200);
        expect(await res.text()).toContain("わざと壊した");
    });

    test("ルート: 各ルートにかかるミドルウェア(パラメーターで始まるルートは「パスによる」)", async () => {
        const a = app();
        a.get("/:page", () => "page");
        const data = await pageData(await a.fetch(req("/_senri"), local));
        const row = (path: string) => data.routes.find((r) => r.path === path)!;

        expect(row("/hello").middlewares).toEqual([
            { name: "logger", applies: "yes" },
            { name: "auth", applies: "no" },
        ]);
        expect(row("/admin/users/:id").middlewares[1]).toEqual({ name: "auth", applies: "yes" });
        expect(row("/:page").middlewares[1]).toEqual({ name: "auth", applies: "maybe" });
    });

    test("ミドルウェア: 登録順・パス指定・直近の平均時間", async () => {
        const a = app();
        await a.fetch(req("/hello"), local);
        await a.fetch(req("/hello"), local);

        const data = await pageData(await a.fetch(req("/_senri"), local));

        expect(data.middlewares.map((m) => [m.order, m.name, m.path, m.runs])).toEqual([
            [1, "logger", null, 2],
            [2, "auth", "/admin", 0],
        ]);
        expect(data.middlewares[0]!.avgSelfMs).toBeGreaterThanOrEqual(0);
        expect(data.middlewares[1]!.avgSelfMs).toBeNull();
    });

    test("ミドルウェア: 同じ名前が2つあっても、登録順で別々に集計する", async () => {
        const a = createApp({ dev: true });
        const named = (label: string) =>
            async function timer(_c: unknown, next: () => Promise<Response>) {
                await next();
                void label;
            };
        a.use(named("1つ目"));
        a.use("/admin", named("2つ目"));
        a.get("/hello", () => "hi");
        await a.fetch(req("/hello"), local);
        await a.fetch(req("/hello"), local);

        const data = await pageData(await a.fetch(req("/_senri"), local));

        expect(data.middlewares.map((m) => [m.order, m.name, m.runs])).toEqual([
            [1, "timer", 2],
            [2, "timer", 0],
        ]);
    });

    test("ミドルウェア: 無名の関数には印が付く(画面で「名前付きの関数にすると名前が出る」と案内する)", async () => {
        const data = await pageData(await app().fetch(req("/_senri"), local));

        expect(data.middlewares.map((m) => [m.name, m.anonymous])).toEqual([
            ["logger", false],
            ["auth", false],
        ]);

        const b = createApp({ dev: true });
        b.use((_c, next) => next());
        const anon = await pageData(await b.fetch(req("/_senri"), local));
        expect(anon.middlewares[0]).toMatchObject({ name: "anonymous#1", anonymous: true });
    });

    test("クリアは、ダッシュボード自身のページからの POST だけ受け付ける", async () => {
        const a = app();
        await a.fetch(req("/hello"), local);
        const log = (await dashboardOf(a))!.log;

        const forged = await a.fetch(req("/_senri/api/clear", { method: "POST", headers: { origin: "http://evil.example" } }), local);
        expect(forged.status).toBe(403);
        expect(log.size).toBe(1);

        const ok = await a.fetch(req("/_senri/api/clear", { method: "POST", headers: { origin: "http://localhost:3927" } }), local);
        expect(ok.status).toBe(204);
        expect(log.size).toBe(0);
    });
});
