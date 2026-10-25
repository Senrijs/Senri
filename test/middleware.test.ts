import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

describe("c.path", () => {
    test("正規化・デコード済みのパスが入っている", async () => {
        const app = createApp();
        const seen: string[] = [];
        app.use((c, next) => {
            seen.push(c.path);
            return next();
        });
        app.get("/admin", () => "ok");
        app.get("/u/:name", () => "ok");

        await app.fetch(req("//admin/"));
        await app.fetch(req("/u/山田"));

        expect(seen).toEqual(["/admin", "/u/山田"]);
    });

    test("c.path で書いた認証は //admin や /%61dmin で素通りできない", async () => {
        const app = createApp();
        app.use((c, next) => {
            if (c.path.startsWith("/admin") && c.req.headers.get("authorization") !== "secret") {
                c.status(401);
                return "ログインしてね";
            }
            return next();
        });
        app.get("/admin", () => "管理画面");

        for (const path of ["/admin", "//admin", "/%61dmin", "/admin/"]) {
            const res = await app.fetch(req(path));
            expect(res.status).toBe(401);
        }
    });

    test("エンコードが不正なら、ミドルウェアで読んだ時点で 400 になる", async () => {
        const app = createApp();
        app.use((c, next) => {
            void c.path;
            return next();
        });

        const res = await app.fetch(req("/%E0%A4%A"));

        expect(res.status).toBe(400);
    });
});

describe("app.use(path, mw)", () => {
    test("そのパスと、その下のパスだけで動く", async () => {
        const app = createApp();
        const seen: string[] = [];
        app.use("/admin", (c, next) => {
            seen.push(c.path);
            return next();
        });
        for (const path of ["/admin", "/admin/users", "/administrator", "/other"]) {
            app.get(path, () => "ok");
        }

        for (const path of ["/admin", "/admin/users", "/administrator", "/other", "//admin", "/%61dmin/users"]) {
            await app.fetch(req(path));
        }

        expect(seen).toEqual(["/admin", "/admin/users", "/admin", "/admin/users"]);
    });

    test("全体のミドルウェアと登録順どおりに並ぶ", async () => {
        const app = createApp();
        const order: string[] = [];
        app.use(async (_c, next) => {
            order.push("global-1");
            await next();
        });
        app.use("/admin", async (_c, next) => {
            order.push("admin");
            await next();
        });
        app.use(async (_c, next) => {
            order.push("global-2");
            await next();
        });
        app.get("/admin", () => "ok");

        await app.fetch(req("/admin"));

        expect(order).toEqual(["global-1", "admin", "global-2"]);
    });
});

describe("next() の呼び方", () => {
    test("何も返さず next() 済みなら、下流のレスポンスを使う", async () => {
        const app = createApp();
        app.use(async (_c, next) => {
            await next();
        });
        app.get("/x", () => "下流");

        const res = await app.fetch(req("/x"));

        expect(await res.text()).toBe("下流");
    });

    test("next() を2回呼ぶとエラーになり、ハンドラーは1回しか動かない", async () => {
        const app = createApp({ dev: true });
        let calls = 0;
        app.use(async (_c, next) => {
            await next();
            return next();
        });
        app.get("/x", () => `call ${++calls}`);

        const res = await app.fetch(req("/x"));

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("next() が2回呼ばれました");
        expect(calls).toBe(1);
    });

    test("next() を await し忘れても、下流のレスポンスを待って使う", async () => {
        const app = createApp();
        app.use((_c, next) => {
            next();
        });
        app.get("/x", async () => {
            await new Promise((r) => setTimeout(r, 10));
            return "遅れて届く";
        });

        const res = await app.fetch(req("/x"));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("遅れて届く");
    });
});
