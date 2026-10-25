import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

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
