// スキーマなしで、パスの値を整数として読む: { params: { id: "int" } } / { params: { id: "uint" } }(#142)
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createApp, createRouter, defineRoutes, endpoint } from "../src/index.ts";
import { openAPI } from "../src/openapi.ts";
import { devtools } from "../src/dev/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

// 整数とみなすもの: ^(0|-?[1-9][0-9]*)$ に合い、Number.isSafeInteger が真のもの("uint" はそのうち 0 以上)
// URL に書いた形と、デコード後の値と、読んだ数
const ACCEPTED: [url: string, value: string, int: number][] = [
    ["0", "0", 0],
    ["7", "7", 7],
    ["42", "42", 42],
    ["9007199254740991", "9007199254740991", Number.MAX_SAFE_INTEGER],
];
const ACCEPTED_NEGATIVE: [url: string, value: string, int: number][] = [
    ["-1", "-1", -1],
    ["-42", "-42", -42],
    ["-9007199254740991", "-9007199254740991", -Number.MAX_SAFE_INTEGER],
];

// 整数とみなさずに 404 にするもの(ドキュメントの表と同じ)
const REJECTED: [url: string, value: string][] = [
    ["01", "01"],
    ["00", "00"],
    ["1.5", "1.5"],
    ["1.0", "1.0"],
    ["%201%20", " 1 "],
    ["+1", "+1"],
    ["1e3", "1e3"],
    ["0x10", "0x10"],
    ["-0", "-0"],
    ["9007199254740992", "9007199254740992"],
    ["-9007199254740992", "-9007199254740992"],
    ["%EF%BC%91", "１"],
    ["1_000", "1_000"],
    ["abc", "abc"],
    ["-", "-"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
];

function makeApp(type: "int" | "uint", dev?: "ja" | "en") {
    const app = createApp({ dev: dev ? devtools({ lang: dev }) : undefined });
    let calls = 0;
    app.get("/notes/:id", { params: { id: type } }, ({ id }, c) => {
        calls++;
        return { id, type: typeof id, params: c.params };
    });
    return { app, calls: () => calls };
}

describe('{ params: { id: "int" } }', () => {
    for (const [url, value, int] of [...ACCEPTED, ...ACCEPTED_NEGATIVE]) {
        test(`"${url}" は ${int}(c.params は文字列のまま)`, async () => {
            const res = await makeApp("int").app.fetch(req(`/notes/${url}`));
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ id: int, type: "number", params: { id: value } });
        });
    }

    for (const [url, value] of REJECTED) {
        test(`${JSON.stringify(value)} は 404(ハンドラーは呼ばない)`, async () => {
            const { app, calls } = makeApp("int");
            const res = await app.fetch(req(`/notes/${url}`));
            expect(res.status).toBe(404);
            expect(await res.text()).toBe("404 Not Found");
            expect(calls()).toBe(0);
        });
    }
});

describe('{ params: { id: "uint" } }', () => {
    for (const [url, , int] of ACCEPTED) {
        test(`"${url}" は ${int}`, async () => {
            const res = await makeApp("uint").app.fetch(req(`/notes/${url}`));
            expect(res.status).toBe(200);
            expect((await res.json()).id).toBe(int);
        });
    }

    for (const [url, value] of [...ACCEPTED_NEGATIVE.map(([u, v]) => [u, v] as const), ...REJECTED]) {
        test(`${JSON.stringify(value)} は 404`, async () => {
            const { app, calls } = makeApp("uint");
            expect((await app.fetch(req(`/notes/${url}`))).status).toBe(404);
            expect(calls()).toBe(0);
        });
    }
});

describe("404 のとき", () => {
    test("app.notFound のハンドラーに回る(onError ではない)", async () => {
        const app = createApp();
        app.onError((_, c) => c.text("onError", 500));
        app.notFound((c) => c.json({ error: "not found", path: c.path }));
        app.get("/notes/:id", { params: { id: "uint" } }, ({ id }) => ({ id }));
        const res = await app.fetch(req("/notes/abc"));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not found", path: "/notes/abc" });
    });

    test("ミドルウェアの next() は 404 の応答を返す(例外にならない)", async () => {
        const app = createApp();
        const seen: number[] = [];
        app.use(async (_, next) => {
            const res = await next();
            seen.push(res.status);
            return res;
        });
        app.get("/notes/:id", { params: { id: "int" } }, ({ id }) => ({ id }));
        expect((await app.fetch(req("/notes/1.5"))).status).toBe(404);
        expect(seen).toEqual([404]);
    });

    test("開発モードでは、どの名前に何が来たかを出す(日本語)", async () => {
        const res = await makeApp("int", "ja").app.fetch(req("/notes/abc"));
        expect(res.status).toBe(404);
        const text = await res.text();
        expect(text).toStartWith('404 Not Found: GET /notes/abc\n:id に整数でない値 "abc" が来ました');
        expect(text).toContain("Number.MAX_SAFE_INTEGER");
    });

    test('開発モード: "uint" は「0 以上の整数」と出す', async () => {
        const res = await makeApp("uint", "ja").app.fetch(req("/notes/-1"));
        expect(await res.text()).toStartWith('404 Not Found: GET /notes/-1\n:id に 0 以上の整数でない値 "-1" が来ました');
    });

    test("開発モード(英語)。ブラウザで開いても、ルートの一覧ではなくこの文言", async () => {
        const res = await makeApp("int", "en").app.fetch(req("/notes/01", { headers: { accept: "text/html" } }));
        expect(res.status).toBe(404);
        expect(await res.text()).toStartWith('404 Not Found: GET /notes/01\n:id got "01", which is not an integer');
    });

    test("開発モードで、ルートがない 404 はこれまでどおり", async () => {
        const res = await makeApp("int", "ja").app.fetch(req("/nope"));
        expect(await res.text()).not.toContain("整数");
    });
});

describe("いろいろな書き方", () => {
    test("query・body のスキーマと一緒に使える", async () => {
        const app = createApp();
        app.post("/notes/:id", { params: { id: "uint" }, query: z.object({ q: z.string() }), body: z.object({ n: z.number() }) }, ({ id }, c) => ({
            id,
            q: c.valid("query").q,
            n: c.valid("body").n,
        }));
        const res = await app.fetch(
            req("/notes/3?q=x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: 1 }) }),
        );
        expect(await res.json()).toEqual({ id: 3, q: "x", n: 1 });
    });

    test("書かなかったパラメーターは文字列のまま", async () => {
        const app = createApp();
        app.get("/users/:uid/notes/:id", { params: { id: "uint" } }, (params) => params);
        expect(await (await app.fetch(req("/users/007/notes/7"))).json()).toEqual({ uid: "007", id: 7 });
    });

    test("createRouter(プレフィックスのパラメーターも読める)と app.on", async () => {
        const router = createRouter("/users/:uid");
        router.get("/notes/:id", { params: { uid: "uint", id: "uint" } }, ({ uid, id }) => ({ sum: uid + id }));
        const app = createApp();
        app.route(router);
        app.on(["PUT", "PATCH"], "/n/:id", { params: { id: "int" } }, ({ id }) => ({ id }));
        expect(await (await app.fetch(req("/users/1/notes/2"))).json()).toEqual({ sum: 3 });
        expect((await app.fetch(req("/users/x/notes/2"))).status).toBe(404);
        expect(await (await app.fetch(req("/n/-5", { method: "PATCH" }))).json()).toEqual({ id: -5 });
    });

    test("defineRoutes() の endpoint()", async () => {
        const app = createApp();
        app.routes(defineRoutes({ "GET /notes/:id": endpoint({ params: { id: "uint" } }, ({ id }) => ({ id })) }));
        expect(await (await app.fetch(req("/notes/5"))).json()).toEqual({ id: 5 });
        expect((await app.fetch(req("/notes/05"))).status).toBe(404);
    });

    test('値が "int" / "uint" でなければ、登録した時点でエラー(本番でも)', () => {
        const app = createApp();
        expect(() => app.get("/notes/:id", { params: { id: "number" } } as never, () => "x")).toThrow("Invalid parameter type: id");
        expect(() => app.get("/notes/:id", { params: { id: "Int" } } as never, () => "x")).toThrow("Invalid parameter type");
    });

    test("開発モード: 値の書き間違いに説明が付く", () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        expect(() => app.get("/notes/:id", { params: { id: "number" } } as never, () => "x")).toThrow('"int"(負の数も含む整数)か "uint"(0 以上の整数)');
    });

    test("開発モード: パスにない名前は、登録した時点でエラー", () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        expect(() => app.get("/notes/:id", { params: { nid: "int" } } as never, () => "x")).toThrow('params の "nid" は、このパスのパラメーターではありません');
        const en = createApp({ dev: devtools({ lang: "en" }) });
        expect(() => en.get("/notes/:id", { params: { nid: "int" } } as never, () => "x")).toThrow('params has "nid", which is not a parameter of this path');
    });

    test("本番: パスにない名前は、リクエストのときにエラー(500。黙って通さない)", async () => {
        const app = createApp();
        app.get("/notes/:id", { params: { nid: "int" } } as never, () => "x");
        const res = await app.fetch(req("/notes/1"));
        expect(res.status).toBe(500);
    });
});

describe("openAPI()", () => {
    test('"int" は integer、"uint" は minimum: 0 も付く', () => {
        const routes = defineRoutes({
            "GET /users/:uid/notes/:id": endpoint({ params: { uid: "int", id: "uint" } }, ({ uid, id }) => ({ uid, id })),
        });
        const doc = openAPI(routes, { info: { title: "T", version: "1" }, onWarning: () => {} }) as any;
        expect(doc.paths["/users/{uid}/notes/{id}"].get.parameters).toEqual([
            { name: "uid", in: "path", required: true, schema: { type: "integer" } },
            { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 0 } },
        ]);
    });
});
