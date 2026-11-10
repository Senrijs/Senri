import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createApp, defineRoutes, endpoint } from "../src/index.ts";
import { deleteCookie, getCookie, setCookie } from "../src/cookie.ts";
import { getIp } from "../src/ip.ts";
import { request, testClient } from "../src/testing.ts";

const routes = defineRoutes({
    "POST /users": endpoint({ body: z.object({ name: z.string() }) }, (_, c) => ({ created: c.valid("body").name })),
    "GET /ip": (_, c) => ({ ip: getIp(c) }),
    "GET /env": (_, c) => ({ env: (c.env as { NAME?: string } | undefined)?.NAME ?? null }),
    "GET /wait": (_, c) => {
        c.executionCtx.waitUntil(Promise.resolve());
        return "ok";
    },
    "POST /login": (_, c) => {
        setCookie(c, "session", "abc");
        return "in";
    },
    "GET /me": (_, c) => ({ session: getCookie(c, "session") ?? null, other: getCookie(c, "other") ?? null }),
    "POST /logout": (_, c) => {
        deleteCookie(c, "session");
        return "out";
    },
    "GET /headers": (_, c) => ({ x: c.req.headers.get("x-a") }),
});
type Api = typeof routes;

const app = createApp();
app.routes(routes);
app.get("/old", (_, c) => `old ${c.query("q") ?? ""}`);

describe("testClient()", () => {
    test("型付きクライアントで、サーバーを立てずに呼ぶ", async () => {
        const api = testClient<Api>(app);
        const res = await api("POST /users", { body: { name: "a" } });
        expect([res.ok, res.status, res.data]).toEqual([true, 200, { created: "a" }]);
        expect((await api("POST /users", { body: { name: 1 } as never })).status).toBe(400);
    });

    test("接続元は 127.0.0.1(ip で変えられる)", async () => {
        expect((await testClient<Api>(app)("GET /ip")).data).toEqual({ ip: "127.0.0.1" });
        expect((await testClient<Api>(app, { ip: "203.0.113.5" })("GET /ip")).data).toEqual({ ip: "203.0.113.5" });
    });

    test("Workers のアプリ向けに env と ctx を渡せる", async () => {
        const waited: Promise<unknown>[] = [];
        const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p), passThroughOnException: () => {} };
        const api = testClient<Api>(app, { env: { NAME: "kv" }, ctx });
        expect((await api("GET /env")).data).toEqual({ env: "kv" });
        expect((await api("GET /wait")).data).toBe("ok");
        expect(waited.length).toBe(1);
    });

    test("cookies: true なら、Set-Cookie を覚えて次から送る。消されたら送らない", async () => {
        const api = testClient<Api>(app, { cookies: true });
        expect((await api("GET /me")).data).toEqual({ session: null, other: null });
        await api("POST /login");
        expect((await api("GET /me")).data).toEqual({ session: "abc", other: null });
        // 呼ぶ側が付けた Cookie と合わせて送る
        expect((await api("GET /me", { headers: { cookie: "other=1" } })).data).toEqual({ session: "abc", other: "1" });
        await api("POST /logout");
        expect((await api("GET /me")).data).toEqual({ session: null, other: null });
    });

    test("cookies を付けなければ、Cookie は覚えない", async () => {
        const api = testClient<Api>(app);
        await api("POST /login");
        expect((await api("GET /me")).data).toEqual({ session: null, other: null });
    });

    test("headers を毎回付ける", async () => {
        const api = testClient<Api>(app, { headers: { "x-a": "1" } });
        expect((await api("GET /headers")).data).toEqual({ x: "1" });
    });
});

describe("request()", () => {
    test("型のないリクエストを送り、Response を返す(表にないルートも)", async () => {
        const res = await request(app, "GET /old?q=x");
        expect(res).toBeInstanceOf(Response);
        expect(await res.text()).toBe("old x");
    });

    test("init を Request に渡す。ヘッダーは options の headers と合わせる", async () => {
        const res = await request(app, "GET /headers", { headers: { "x-a": "2" } }, { headers: { "x-a": "1" } });
        expect(await res.json()).toEqual({ x: "2" });
        const posted = await request(app, "POST /users", { headers: { "content-type": "application/json" }, body: '{"name":"b"}' });
        expect(await posted.json()).toEqual({ created: "b" });
    });

    test("接続元は 127.0.0.1", async () => {
        expect(await (await request(app, "GET /ip")).json()).toEqual({ ip: "127.0.0.1" });
    });

    test("ルートの書き方が違えばエラー", async () => {
        await expect(request(app, "GET/old")).rejects.toThrow("Invalid route");
        await expect(request(app, "GET old")).rejects.toThrow("Invalid route");
    });

    test("baseUrl の末尾の \"/\" は、いくつあっても削る", async () => {
        const seen: string[] = [];
        const spy = { fetch: (req: Request) => (seen.push(req.url), new Response("")) };
        await request(spy, "GET /a", {}, { baseUrl: "https://example.com/api///" });
        expect(seen).toEqual(["https://example.com/api/a"]);
    });

    test("\"/\" が長く続いて最後が別の文字の baseUrl でも、すぐ終わる(時間が長さの 2 乗にならない)", async () => {
        // 以前の /\/+$/ は、始まる位置ごとに読み直すので、10 万文字で十数秒かかった
        const spy = { fetch: () => new Response("") };
        for (const baseUrl of ["http://x" + "/".repeat(100_000) + "a", "http://x" + "/".repeat(100_000)]) {
            const started = performance.now();
            await request(spy, "GET /a", {}, { baseUrl });
            expect(performance.now() - started).toBeLessThan(100);
        }
    });
});
