import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { devtools, isLocalUrl } from "../src/dev/index.ts";

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

// Workers とブラウザ(process がない環境)では NODE_ENV が読めないので、request.url のホスト名が localhost のときだけ
// 開発用の出力をする。それ以外は、そのリクエストだけ本番と同じ
describe("NODE_ENV が読めない環境(Workers・ブラウザ)", () => {
    const realProcess = (globalThis as { process?: unknown }).process;
    const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

    // devtools() を呼ぶ間だけ、その環境のふりをする
    function devtoolsIn(env: "workers" | "browser" | "node" | "deno") {
        try {
            if (env === "workers") {
                Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
            }
            if (env === "browser") Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
            if (env === "deno") {
                g.Deno = {
                    permissions: { querySync: () => ({ state: "granted" }) },
                    env: { get: () => "development" },
                    cwd: () => "/",
                };
            }
            return devtools();
        } finally {
            (globalThis as { process?: unknown }).process = realProcess;
            if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
            delete g.Deno;
        }
    }

    function appIn(env: "workers" | "browser" | "node" | "deno") {
        const app = createApp({ dev: devtoolsIn(env) });
        app.get("/users/:id", () => "ok");
        app.get("/boom", () => {
            throw new Error("DB password=hunter2");
        });
        return app;
    }

    async function leaks(app: ReturnType<typeof appIn>, origin: string, headers: Record<string, string> = {}) {
        const html = { accept: "text/html", ...headers };
        const results = await Promise.all(
            [
                new Request(`${origin}/boom`, { headers }),
                new Request(`${origin}/boom`, { headers: html }),
                new Request(`${origin}/nope`, { headers: html }),
                new Request(`${origin}/users/1`, { method: "DELETE", headers }),
            ].map(async (r) => {
                const res = await app.fetch(r);
                return { status: res.status, type: res.headers.get("content-type"), timing: res.headers.get("server-timing"), body: await res.text() };
            }),
        );
        return results;
    }

    for (const env of ["workers", "browser"] as const) {
        test(`${env}: localhost でない URL には、エラーの中身・ルート・Server-Timing を出さない(Host: localhost を付けても)`, async () => {
            const app = appIn(env);
            const variants: Record<string, string>[] = [{}, { host: "localhost" }, { "x-forwarded-host": "localhost" }];
            for (const headers of variants) {
                const [text, page, notFound, notAllowed] = await leaks(app, "https://example.com", headers);
                expect(text).toEqual({ status: 500, type: "text/plain; charset=utf-8", timing: null, body: "500 Internal Server Error" });
                expect(page).toEqual({ status: 500, type: "text/plain; charset=utf-8", timing: null, body: "500 Internal Server Error" });
                expect(notFound).toEqual({ status: 404, type: "text/plain; charset=utf-8", timing: null, body: "404 Not Found" });
                expect(notAllowed!.body).toBe("405 Method Not Allowed");
            }
        });

        test(`${env}: localhost の URL なら、今までどおり開発用の出力をする`, async () => {
            const app = appIn(env);
            for (const origin of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787", "http://app.localhost"]) {
                const [text, page, notFound, notAllowed] = await leaks(app, origin);
                expect(text!.body).toContain("hunter2");
                expect(text!.timing).toContain("senri-total");
                expect(page!.type).toBe("text/html; charset=utf-8");
                expect(notFound!.type).toBe("text/html; charset=utf-8");
                expect(notAllowed!.body).toContain("ならあります");
            }
        });
    }

    // process がある環境は、今までどおり NODE_ENV だけで決まる(URL のホスト名は見ない)
    for (const env of ["node", "deno"] as const) {
        test(`${env}: NODE_ENV が本番でなければ、どの URL でも開発用の出力をする`, async () => {
            const app = appIn(env);
            const [text, page] = await leaks(app, "https://example.com");
            expect(text!.body).toContain("hunter2");
            expect(page!.type).toBe("text/html; charset=utf-8");
        });
    }

    test("isLocalUrl はホスト名だけを見る", () => {
        expect(isLocalUrl("http://localhost/")).toBe(true);
        expect(isLocalUrl("http://LOCALHOST:3000/x")).toBe(true);
        expect(isLocalUrl("http://127.1.2.3/")).toBe(true);
        expect(isLocalUrl("http://[::1]/")).toBe(true);
        expect(isLocalUrl("http://my.localhost/")).toBe(true);
        expect(isLocalUrl("https://example.com/localhost")).toBe(false);
        expect(isLocalUrl("https://localhost.example.com/")).toBe(false);
        expect(isLocalUrl("https://127.0.0.1.example.com/")).toBe(false);
        expect(isLocalUrl("/relative")).toBe(false);
    });
});
