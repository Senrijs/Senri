import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const g = globalThis as { Deno?: unknown };

describe("devtools()", () => {
    const original = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = original;
        delete g.Deno;
    });

    test("開発モードの機能(「もしかして」付きの 404、Server-Timing)が入る", async () => {
        const app = createApp({ dev: devtools() });
        app.get("/hello", () => "hi");
        const res = await app.fetch(req("/helo"));
        expect(await res.text()).toBe("404 Not Found: GET /helo\nもしかして: GET /hello ?");
        expect(res.headers.get("server-timing")).toContain("senri-total");
    });

    test("NODE_ENV=production では何もしない(消し忘れても本番に開発ページは出ない)", async () => {
        process.env.NODE_ENV = "production";
        expect(devtools()).toBeUndefined();
        const app = createApp({ dev: devtools() });
        app.get("/boom", () => {
            throw new Error("secret");
        });
        const res = await app.fetch(req("/boom", { headers: { accept: "text/html" } }));
        expect([res.status, await res.text()]).toEqual([500, "500 Internal Server Error"]);
        expect(res.headers.get("server-timing")).toBeNull();
    });

    test("Deno で NODE_ENV を読む許可がなければ、無効にして --allow-env=NODE_ENV を案内する", () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            // 許可を聞かれる状態(prompt)の Deno のふり。env.get は呼ばれたら失敗にする
            g.Deno = {
                permissions: { querySync: () => ({ state: "prompt" }) },
                env: {
                    get() {
                        throw new Error("読もうとした(許可を求めるプロンプトが出てしまう)");
                    },
                },
                cwd: () => "/",
            };
            expect(devtools()).toBeUndefined();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]![0])).toContain("--allow-env=NODE_ENV");
        } finally {
            warn.mockRestore();
        }
    });
});

describe("0.1 の createApp({ dev: true })", () => {
    test("エラーにして、devtools() の使い方を日本語と英語で案内する", () => {
        let message = "";
        try {
            createApp({ dev: true as never });
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain("is no longer supported");
        expect(message).toContain("使えなくなりました");
        expect(message).toContain('import { devtools } from "@senrijs/senri/dev";');
        expect(message).toContain("createApp({ dev: devtools() })");
    });
});
