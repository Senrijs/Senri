import { describe, expect, test } from "bun:test";
import { createApp, HttpError } from "../src/index.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

describe("HttpError", () => {
    test("投げると、その status と message でレスポンスになる", async () => {
        const app = createApp();
        app.get("/secret", () => {
            throw new HttpError(403, "見せられません");
        });

        const res = await app.fetch(req("/secret"));

        expect(res.status).toBe(403);
        expect(await res.text()).toBe("見せられません");
    });

    test("headers を付けられる", async () => {
        const app = createApp();
        app.get("/limited", () => {
            throw new HttpError(429, "待ってね", { headers: { "retry-after": "10" } });
        });

        const res = await app.fetch(req("/limited"));

        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("10");
    });
});

describe("app.onError", () => {
    test("ハンドラーの例外を受け取って、好きなレスポンスにできる", async () => {
        const app = createApp();
        app.onError((err) => ({ error: err instanceof Error ? err.message : "?" }));
        app.get("/boom", () => {
            throw new Error("壊れた");
        });

        const res = await app.fetch(req("/boom"));

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "壊れた" });
    });

    test("ミドルウェアの例外も受け取る", async () => {
        const app = createApp();
        app.onError(() => "ミドルウェアで失敗");
        app.use(() => {
            throw new Error("mw");
        });
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x"));

        expect(res.status).toBe(500);
        expect(await res.text()).toBe("ミドルウェアで失敗");
    });

    test("HttpError なら、その status が使われる", async () => {
        const app = createApp();
        app.onError((err) => `エラー: ${(err as HttpError).message}`);
        app.get("/x", () => {
            throw new HttpError(418, "ティーポット");
        });

        const res = await app.fetch(req("/x"));

        expect(res.status).toBe(418);
        expect(await res.text()).toBe("エラー: ティーポット");
    });

    test("405 も HttpError として onError に届き、Allow ヘッダーが付く", async () => {
        const app = createApp();
        let received: unknown;
        app.onError((err) => {
            received = err;
            return "405です";
        });
        app.get("/hello", () => "hi");

        const res = await app.fetch(req("/hello", { method: "POST" }));

        expect(received).toBeInstanceOf(HttpError);
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
        expect(await res.text()).toBe("405です");
    });
});

describe("どこで失敗しても app.fetch は reject しない", () => {
    test("ミドルウェアが JSON にできない値を返しても 500 になる", async () => {
        const app = createApp();
        app.use(() => ({ n: 1n }));

        const res = await app.fetch(req("/"));

        expect(res.status).toBe(500);
    });

    test("onError 自体が投げても、固定文言の 500 になる", async () => {
        const app = createApp();
        app.onError(() => {
            throw new Error("onError も壊れた");
        });
        app.get("/boom", () => {
            throw new Error("壊れた");
        });

        const res = await app.fetch(req("/boom"));

        expect(res.status).toBe(500);
        expect(await res.text()).toBe("500 Internal Server Error");
    });

    test("notFound が投げると onError に届く", async () => {
        const app = createApp();
        app.notFound(() => {
            throw new Error("notFound が壊れた");
        });
        app.onError((err) => `onError: ${(err as Error).message}`);

        const res = await app.fetch(req("/nope"));

        expect(res.status).toBe(500);
        expect(await res.text()).toBe("onError: notFound が壊れた");
    });
});

describe("app.notFound", () => {
    test("見つからないときのレスポンスを変えられる(status は 404 のまま)", async () => {
        const app = createApp();
        app.notFound((c) => `ないよ: ${new URL(c.req.url).pathname}`);

        const res = await app.fetch(req("/nope"));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("ないよ: /nope");
    });
});
