import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";

// テスト用のリクエストを作る小道具
const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

describe("ルーティング", () => {
    test("文字列を返すとテキストになる", async () => {
        const app = createApp();
        app.get("/hello", () => "hi");

        const res = await app.fetch(req("/hello"));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hi");
    });

    test("パスパラメーターが受け取れる", async () => {
        const app = createApp();
        app.get("/users/:id", ({ id }) => `user ${id}`);

        const res = await app.fetch(req("/users/42"));

        expect(await res.text()).toBe("user 42");
    });

    test("オブジェクトを返すと JSON になる", async () => {
        const app = createApp();
        app.get("/user", () => ({ name: "yahari" }));

        const res = await app.fetch(req("/user"));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/json");
        expect(await res.json()).toEqual({ name: "yahari" });
    });

        test("固定のパスがパラメーターより優先される", async () => {
        const app = createApp();
        // わざとパラメーターのほうを先に登録する
        app.get("/users/:id", ({ id }) => `user ${id}`);
        app.get("/users/me", () => "それは自分です");

        const res = await app.fetch(req("/users/me"));

        expect(await res.text()).toBe("それは自分です");
    });

    test("見つからないと404で「もしかして」が出る(開発モード)", async () => {
        const app = createApp({ dev: true });
        app.get("/hello", () => "hi");

        const res = await app.fetch(req("/helo"));

        expect(res.status).toBe(404);
        expect(await res.text()).toContain("もしかして");
    });

        test("メソッドが違うと405で、allowヘッダーが付く", async () => {
        const app = createApp();
        app.get("/hello", () => "hi");

        const res = await app.fetch(req("/hello", { method: "POST" }));

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    });

    test("c.status(201) で返すと201になる", async () => {
        const app = createApp();
        app.get("/created", (_, c) => {
            c.status(201);
            return { ok: true };
        });

        const res = await app.fetch(req("/created"));

        expect(res.status).toBe(201);
    });
});

describe("ミドルウェアとエラー", () => {
    test("ミドルウェアが値を返すと、ハンドラーまで届かない", async () => {
        const app = createApp();
        let called = false;

        app.use(() => {
            return "止めました";        // next() を呼ばずに何か返す
        });
        app.get("/secret", () => {
            called = true;
            return "ひみつ";
        });

        const res = await app.fetch(req("/secret"));

        expect(await res.text()).toBe("止めました");
        expect(called).toBe(false);
    });

    test("ハンドラーで例外を投げると500になる", async () => {
        const app = createApp();
        app.get("/boom", () => {
            throw new Error("わざと壊した");
        });

        const res = await app.fetch(req("/boom"));

        expect(res.status).toBe(500);
    });

    test("app.routes で登録できる", async () => {
        const app = createApp();
        app.routes({
            "POST /x": () => "posted",
        });

        const res = await app.fetch(req("/x", { method: "POST" }));

        expect(await res.text()).toBe("posted");
    });
});