import { describe, expect, spyOn, test } from "bun:test";
import { createApp, createRouter, HttpError, logger, type App } from "../src/index.ts";
import { setCookie } from "../src/cookie.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("c.notFound()", () => {
    describe("ハンドラーから", () => {
        test("既定の 404 になる", async () => {
            const app = createApp();
            app.get("/items/:id", (_, c) => c.notFound());

            const res = await app.fetch(req("/items/1"));

            expect(res.status).toBe(404);
            expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
            expect(await res.text()).toBe("404 Not Found");
        });

        test("ルートがないときと同じレスポンスになる", async () => {
            const app = createApp();
            app.get("/items/:id", (_, c) => c.notFound());

            const called = await app.fetch(req("/items/1"));
            const missing = await app.fetch(req("/missing"));

            expect(called.status).toBe(missing.status);
            expect(await called.text()).toBe(await missing.text());
        });

        test("そのあとのコードは動かない(同期 / 非同期 / return なし)", async () => {
            const app = createApp();
            let reached = false;
            app.get("/sync", (_, c) => {
                c.notFound();
                reached = true;
                return "ここには来ない";
            });
            app.get("/async", async (_, c) => {
                await Promise.resolve();
                c.notFound();
                reached = true;
                return "ここには来ない";
            });

            for (const path of ["/sync", "/async"]) {
                expect((await app.fetch(req(path))).status).toBe(404);
            }
            expect(reached).toBe(false);
        });

        test("c.status() で決めた status より 404 が優先", async () => {
            const app = createApp();
            app.get("/x", (_, c) => {
                c.status(201);
                return c.notFound();
            });

            expect((await app.fetch(req("/x"))).status).toBe(404);
        });
    });

    describe("ミドルウェアから", () => {
        test("next() の前なら、ハンドラーは動かない", async () => {
            const app = createApp();
            let reached = false;
            app.use("/hidden", (c) => c.notFound());
            app.get("/hidden", () => {
                reached = true;
                return "ここには来ない";
            });

            const res = await app.fetch(req("/hidden"));

            expect(res.status).toBe(404);
            expect(await res.text()).toBe("404 Not Found");
            expect(reached).toBe(false);
        });

        test("next() のあとなら、下流のレスポンスを 404 に置き換える", async () => {
            const app = createApp();
            app.use("/x", async (c, next) => {
                await next();
                return c.notFound();
            });
            app.get("/x", () => "下流");

            const res = await app.fetch(req("/x"));

            expect(res.status).toBe(404);
            expect(await res.text()).toBe("404 Not Found");
        });

        test("ルートがないパスでも呼べる", async () => {
            const app = createApp();
            app.use((c) => c.notFound());

            expect((await app.fetch(req("/missing"))).status).toBe(404);
        });
    });

    describe("外側のミドルウェアから見たとき(HttpError と同じ)", () => {
        // 外側で next() の結果を記録するアプリ
        function watched(seen: string[]) {
            const app = createApp();
            app.use(async (_c, next) => {
                try {
                    const res = await next();
                    seen.push(`返った: ${res.status}`);
                    return res;
                } catch {
                    seen.push("投げた");
                    throw new Error("ここには来ない");
                }
            });
            return app;
        }

        test("await next() は投げずに、404 のレスポンスを返す", async () => {
            const seen: string[] = [];
            const app = watched(seen);
            app.get("/nf", (_, c) => c.notFound());
            app.get("/http", () => {
                throw new HttpError(404, "HttpError");
            });

            await app.fetch(req("/nf"));
            await app.fetch(req("/http"));

            expect(seen).toEqual(["返った: 404", "返った: 404"]);
        });

        test("内側のミドルウェアから呼んでも同じ", async () => {
            const seen: string[] = [];
            const app = watched(seen);
            app.use("/x", (c) => c.notFound());
            app.get("/x", () => "ここには来ない");

            await app.fetch(req("/x"));

            expect(seen).toEqual(["返った: 404"]);
        });
    });

    describe("同じ関数の try/catch", () => {
        test("捕まえられる。HttpError 404 として見える", async () => {
            const app = createApp();
            let caught: unknown;
            app.get("/x", (_, c) => {
                try {
                    return c.notFound();
                } catch (err) {
                    caught = err;
                    return "握りつぶした";
                }
            });

            const res = await app.fetch(req("/x"));

            expect(res.status).toBe(200);
            expect(await res.text()).toBe("握りつぶした");
            expect(caught).toBeInstanceOf(HttpError);
            expect((caught as HttpError).status).toBe(404);
        });

        test("HttpError を投げ直せば、notFound ハンドラーに届く", async () => {
            const app = createApp();
            app.notFound(() => "notFound に来た");
            app.get("/x", (_, c) => {
                try {
                    return c.notFound();
                } catch (err) {
                    if (err instanceof HttpError) throw err;
                    return "ここには来ない";
                }
            });

            expect(await (await app.fetch(req("/x"))).text()).toBe("notFound に来た");
        });
    });

    describe("行き先", () => {
        test("app.notFound で替えたハンドラーに回り、onError は呼ばれない", async () => {
            const app = createApp();
            let errors = 0;
            app.onError((_, c) => {
                errors++;
                return c.text("onError");
            });
            app.notFound((c) => ({ error: "ありません", path: c.path }));
            app.get("/items/:id", (_, c) => c.notFound());
            app.use("/hidden", (c) => c.notFound());
            app.get("/hidden", () => "ここには来ない");

            for (const path of ["/items/1", "/hidden"]) {
                const res = await app.fetch(req(path));
                expect(res.status).toBe(404);
                expect(res.headers.get("content-type")).toBe("application/json");
                expect(await res.json()).toEqual({ error: "ありません", path });
            }
            expect(errors).toBe(0);
        });

        test("new HttpError(404) は、今までどおり onError に行く", async () => {
            const app = createApp();
            app.notFound(() => "notFound");
            app.onError((_, c) => c.text("onError"));
            app.get("/x", () => {
                throw new HttpError(404, "x");
            });

            const res = await app.fetch(req("/x"));

            expect(res.status).toBe(404);
            expect(await res.text()).toBe("onError");
        });

        test("ハンドラーを呼ぶ時点で、status は 404 になっている", async () => {
            const app = createApp();
            app.notFound(() => "文字列を返すだけ");
            app.get("/x", (_, c) => {
                c.status(201);
                return c.notFound();
            });

            expect((await app.fetch(req("/x"))).status).toBe(404);
        });

        test("ハンドラーが Response を返せば、その status のまま", async () => {
            const app = createApp();
            app.notFound(() => new Response("gone", { status: 410 }));
            app.get("/x", (_, c) => c.notFound());

            expect((await app.fetch(req("/x"))).status).toBe(410);
        });

        test("非同期のハンドラーでもよい", async () => {
            const app = createApp();
            app.notFound(async () => {
                await Promise.resolve();
                return "待ってから";
            });
            app.get("/x", (_, c) => c.notFound());

            const res = await app.fetch(req("/x"));

            expect(res.status).toBe(404);
            expect(await res.text()).toBe("待ってから");
        });
    });

    describe("ネスト", () => {
        function parent(): App {
            const app = createApp();
            app.notFound(() => "親の notFound");
            return app;
        }

        test("app.route(prefix, app): つないだアプリの notFound ではなく、親のものを使う", async () => {
            const child = createApp();
            child.notFound(() => "子の notFound");
            child.get("/x", (_, c) => c.notFound());
            const app = parent();
            app.route("/child", child);

            const res = await app.fetch(req("/child/x"));

            expect(res.status).toBe(404);
            expect(await res.text()).toBe("親の notFound");
        });

        test("つないだアプリのミドルウェアから呼んでも同じ", async () => {
            const child = createApp();
            child.use("/x", (c) => c.notFound());
            child.get("/x", () => "ここには来ない");
            const app = parent();
            app.route("/child", child);

            expect(await (await app.fetch(req("/child/x"))).text()).toBe("親の notFound");
        });

        test("createRouter: 親のものを使う", async () => {
            const router = createRouter("/users/:id");
            router.get("/posts", (_, c) => c.notFound());
            const app = parent();
            app.route(router);

            expect(await (await app.fetch(req("/users/1/posts"))).text()).toBe("親の notFound");
        });

        test("子のアプリを単独で動かせば、子の notFound を使う", async () => {
            const child = createApp();
            child.notFound(() => "子の notFound");
            child.get("/x", (_, c) => c.notFound());

            expect(await (await child.fetch(req("/x"))).text()).toBe("子の notFound");
        });
    });

    describe("ヘッダー", () => {
        test("c.header() と Set-Cookie が、404 のレスポンスにも付く", async () => {
            const app = createApp();
            app.use((c, next) => {
                c.header("access-control-allow-origin", "*");
                return next();
            });
            app.use(async (c, next) => {
                const res = await next();
                c.header("x-after", "1");
                return res;
            });
            app.get("/x", (_, c) => {
                setCookie(c, "session", "abc");
                setCookie(c, "seen", "1");
                c.header("x-mark", "1");
                return c.notFound();
            });

            const res = await app.fetch(req("/x"));

            expect(res.status).toBe(404);
            expect(res.headers.get("access-control-allow-origin")).toBe("*");
            expect(res.headers.get("x-after")).toBe("1");
            expect(res.headers.get("x-mark")).toBe("1");
            expect(res.headers.getSetCookie()).toEqual([
                "session=abc; Path=/; HttpOnly; SameSite=Lax",
                "seen=1; Path=/; HttpOnly; SameSite=Lax",
            ]);
        });

        test("ミドルウェアがなくても付く", async () => {
            const app = createApp();
            app.get("/x", (_, c) => {
                c.header("x-mark", "1");
                return c.notFound();
            });

            expect((await app.fetch(req("/x"))).headers.get("x-mark")).toBe("1");
        });
    });

    describe("notFound ハンドラーの中で呼んだとき", () => {
        function looping(count: { n: number }) {
            const app = createApp();
            app.notFound((c) => {
                count.n++;
                return c.notFound();
            });
            app.get("/x", (_, c) => c.notFound());
            return app;
        }

        test.each(["/x", "/missing"])("%s: ハンドラーは1回だけ呼ばれ、既定の 404 になる", async (path) => {
            const count = { n: 0 };

            const res = await looping(count).fetch(req(path));

            expect(res.status).toBe(404);
            expect(await res.text()).toBe("404 Not Found");
            expect(count.n).toBe(1);
        });

        test("ハンドラーが c.status() を変えていても 404", async () => {
            const app = createApp();
            app.notFound((c) => c.status(200).notFound());

            expect((await app.fetch(req("/missing"))).status).toBe(404);
        });
    });

    describe("壊れているとき", () => {
        test.each(["/x", "/missing"])("%s: notFound ハンドラーが投げたら onError に回る", async (path) => {
            const app = createApp();
            app.notFound(() => {
                throw new Error("壊れている");
            });
            app.onError((err, c) => c.text(`onError: ${(err as Error).message}`));
            app.get("/x", (_, c) => c.notFound());

            const res = await app.fetch(req(path));

            expect(res.status).toBe(500);
            expect(await res.text()).toBe("onError: 壊れている");
        });

        test("notFound ハンドラーが HttpError を投げたら、その status で onError に回る", async () => {
            const app = createApp();
            app.notFound(() => {
                throw new HttpError(410, "Gone");
            });
            app.get("/x", (_, c) => c.notFound());

            const res = await app.fetch(req("/x"));

            expect(res.status).toBe(410);
            expect(await res.text()).toBe("Gone");
        });

        test("onError の中で呼んだら、固定の 500(notFound ハンドラーには回さない)", async () => {
            const app = createApp();
            let reached = false;
            app.notFound(() => {
                reached = true;
                return "ここには来ない";
            });
            app.onError((_, c) => c.notFound());
            app.get("/boom", () => {
                throw new Error("x");
            });

            const res = await app.fetch(req("/boom"));

            expect(res.status).toBe(500);
            expect(await res.text()).toBe("500 Internal Server Error");
            expect(reached).toBe(false);
        });
    });

    describe("HEAD", () => {
        test("GET のルートを通っても 404 になり、ヘッダーも付く", async () => {
            const app = createApp();
            app.get("/x", (_, c) => {
                c.header("x-mark", "1");
                return c.notFound();
            });

            const res = await app.fetch(req("/x", { method: "HEAD" }));

            expect(res.status).toBe(404);
            expect(res.headers.get("x-mark")).toBe("1");
        });

        test("実際のサーバー(Bun.serve)では本文を送らない", async () => {
            const app = createApp();
            app.get("/x", (_, c) => c.notFound());
            const server = Bun.serve({ port: 0, fetch: (r, s) => app.fetch(r, s) });
            try {
                const res = await fetch(new URL("/x", server.url), { method: "HEAD" });

                expect(res.status).toBe(404);
                expect(await res.text()).toBe("");
            } finally {
                await server.stop(true);
            }
        });
    });

    test("ロガーには 404 として記録され、エラーは付かない", async () => {
        const log = spyOn(console, "log").mockImplementation(() => {});
        try {
            const app = createApp();
            app.use(logger({ format: "json" }));
            app.get("/x", (_, c) => c.notFound());

            const res = await app.fetch(req("/x"));

            expect(res.status).toBe(404);
            expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
                level: 40,
                req: { method: "GET", url: "/x" },
                res: { statusCode: 404 },
                msg: "request completed",
            });
            expect(JSON.parse(String(log.mock.calls[0]![0])).err).toBeUndefined();
        } finally {
            log.mockRestore();
        }
    });

    test("ミドルウェアから読む c.error には入らない", async () => {
        const app = createApp();
        let error: unknown = "読んでいない";
        app.use(async (c, next) => {
            const res = await next();
            error = c.error;
            return res;
        });
        app.get("/x", (_, c) => c.notFound());

        await app.fetch(req("/x"));

        expect(error).toBeUndefined();
    });
});
