import { describe, expect, test } from "bun:test";
import { createApp, HttpError } from "../../src/index.ts";
import { dashboardOf } from "../../src/dev/index.ts";

const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);

function app() {
    const a = createApp({ dev: true });
    a.use(async function logger(_c, next) {
        await next();
    });
    a.use("/admin", function auth(c) {
        c.status(401);
        return "ログインしてね";
    });
    a.get("/users/:id", ({ id }) => `user ${id}`);
    a.get("/admin", () => "管理画面");
    a.get("/boom", () => {
        throw new Error("わざと壊した");
    });
    a.get("/cookie", (_, c) => {
        c.header("set-cookie", "session=secret");
        return "ok";
    });
    return a;
}

async function lastRecord(a: ReturnType<typeof app>) {
    return (await dashboardOf(a))!.log.list()[0]!;
}

describe("リクエストの記録(開発モード)", () => {
    test("メソッド・パス・ルート・params・status・時間・時刻", async () => {
        const a = app();
        const before = Date.now();

        await a.fetch(req("/users/42?tab=posts"));
        const r = await lastRecord(a);

        expect(r).toMatchObject({
            method: "GET",
            path: "/users/42",
            query: "?tab=posts",
            route: "/users/:id",
            params: { id: "42" },
            status: 200,
            error: null,
        });
        expect(r.durationMs).toBeGreaterThanOrEqual(0);
        expect(r.time).toBeGreaterThanOrEqual(before);
    });

    test("層ごとの状態: 通過 / ここで終了 / 未到達(パス指定のミドルウェアも、かかるときだけ並ぶ)", async () => {
        const a = app();

        await a.fetch(req("/admin"));
        const admin = await lastRecord(a);
        await a.fetch(req("/users/1"));
        const user = await lastRecord(a);

        expect(admin.layers.map((l) => [l.name, l.state])).toEqual([
            ["logger", "ok"],
            ["auth", "stopped"],
            ["handler", "skipped"],
        ]);
        // /users/1 には /admin のミドルウェアはかからない
        expect(user.layers.map((l) => [l.name, l.state])).toEqual([
            ["logger", "ok"],
            ["handler", "ok"],
        ]);
        // 外側から順に字下げが深くなる
        expect(admin.layers.map((l) => l.depth)).toEqual([0, 1, 2]);
    });

    test("例外が起きた層と、エラーページと同じ中身(Accept が */* でも記録する)", async () => {
        const a = app();

        await a.fetch(req("/boom", { headers: { accept: "*/*" } }));
        const r = await lastRecord(a);

        expect(r.status).toBe(500);
        expect(r.layers.at(-1)).toMatchObject({ name: "handler", state: "failed" });
        expect(r.error!.error).toEqual({ name: "Error", message: "わざと壊した" });
        expect(r.error!.frames.length).toBeGreaterThan(0);
    });

    test("意図した 4xx の HttpError はエラーとして記録しない", async () => {
        const a = createApp({ dev: true });
        a.get("/x", () => {
            throw new HttpError(403, "だめ");
        });

        await a.fetch(req("/x"));

        expect((await lastRecord(a as ReturnType<typeof app>)).error).toBeNull();
    });

    test("ヘッダーは伏せ字にして記録する(リクエストもレスポンスも)", async () => {
        const a = app();

        await a.fetch(req("/cookie", { headers: { authorization: "Bearer abc", accept: "text/plain" } }));
        const r = await lastRecord(a);

        expect(r.requestHeaders).toContainEqual(["authorization", "***"]);
        expect(r.requestHeaders).toContainEqual(["accept", "text/plain"]);
        expect(r.responseHeaders).toContainEqual(["set-cookie", "***"]);
    });

    test("記録した順に id が振られる", async () => {
        const a = app();

        await a.fetch(req("/users/1"));
        await a.fetch(req("/users/2"));
        const [second, first] = (await dashboardOf(a))!.log.list();

        expect(Number(second!.id)).toBeGreaterThan(Number(first!.id));
    });
});

describe("本番", () => {
    test("記録しない(ダッシュボード自体を作らない)", async () => {
        const a = createApp();
        a.get("/x", () => "x");

        await a.fetch(req("/x"));

        expect(await dashboardOf(a)).toBeUndefined();
    });
});
