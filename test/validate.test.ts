import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import * as v from "valibot";
import { z } from "zod";
import { createApp, createRouter, ValidationError, type StandardSchemaV1 } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const json = (path: string, body: unknown, method = "POST") =>
    req(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// 3つのライブラリで、同じ形のスキーマ
const LIBS = {
    zod: {
        params: z.object({ id: z.coerce.number().int() }),
        query: z.object({ page: z.coerce.number().default(1) }),
        body: z.object({ name: z.string().min(1), age: z.number() }),
    },
    valibot: {
        params: v.object({ id: v.pipe(v.string(), v.transform(Number), v.integer()) }),
        query: v.object({ page: v.optional(v.pipe(v.string(), v.transform(Number)), "1") }),
        body: v.object({ name: v.pipe(v.string(), v.minLength(1)), age: v.number() }),
    },
    arktype: {
        params: type({ id: "string.integer.parse" }),
        query: type({ "page?": "string.numeric.parse" }),
        body: type({ name: "string > 0", age: "number" }),
    },
};

describe("Standard Schema によるバリデーション", () => {
    for (const [name, schemas] of Object.entries(LIBS)) {
        describe(name, () => {
            function makeApp(dev = false) {
                const app = createApp({ dev });
                app.post("/users/:id", schemas, ({ id }, c) => ({
                    id,
                    params: c.params,
                    query: c.valid("query"),
                    body: c.valid("body"),
                }));
                return app;
            }

            test("通れば、変換後の値がハンドラーに届く", async () => {
                const res = await makeApp().fetch(json("/users/42?page=3", { name: "yahari", age: 20 }));
                expect(res.status).toBe(200);
                const data = await res.json();
                expect(data.id).toBe(42);
                expect(data.params).toEqual({ id: 42 });
                expect(Number(data.query.page)).toBe(3);
                expect(data.body).toEqual({ name: "yahari", age: 20 });
            });

            test("ボディが合わなければ 400。本番では中身を出さない", async () => {
                const res = await makeApp().fetch(json("/users/42", { name: "", age: "x" }));
                expect(res.status).toBe(400);
                expect(await res.text()).toBe("400 Bad Request");
            });

            test("開発モードでは、どこが違うかを返す", async () => {
                const res = await makeApp(true).fetch(json("/users/42", { name: "yahari", age: "x" }));
                expect(res.status).toBe(400);
                const text = await res.text();
                expect(text).toStartWith("400 Bad Request: ボディが、スキーマに合いません\n- age: ");
            });

            test("パスパラメーターが合わなければ 400(ハンドラーは呼ばない)", async () => {
                const res = await makeApp(true).fetch(json("/users/abc", { name: "yahari", age: 20 }));
                expect(res.status).toBe(400);
                expect(await res.text()).toStartWith("400 Bad Request: パスパラメーターが、スキーマに合いません\n- id: ");
            });
        });
    }
});

describe("ValidationError", () => {
    test("onError で受けて、自分の形で返せる", async () => {
        const app = createApp();
        app.onError((err, c) => {
            if (err instanceof ValidationError) {
                return c.status(422).json({ target: err.target, issues: err.issues.map((i) => i.message) });
            }
            return c.text("error");
        });
        app.post("/", { body: z.object({ n: z.number() }) }, (_, c) => c.valid("body"));
        const res = await app.fetch(json("/", { n: "x" }));
        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.target).toBe("body");
        expect(data.issues).toHaveLength(1);
    });

    test("ネストしたパスは user[0].name のように出す", async () => {
        const app = createApp({ dev: true });
        app.post("/", { body: z.object({ users: z.array(z.object({ name: z.string() })) }) }, () => "ok");
        const res = await app.fetch(json("/", { users: [{ name: 1 }] }));
        expect(await res.text()).toContain("- users[0].name: ");
    });
});

describe("いろいろな書き方", () => {
    // 非同期の validate も使える(Standard Schema では Promise を返してよい)
    const asyncSchema: StandardSchemaV1<unknown, { ok: true }> = {
        "~standard": {
            version: 1,
            vendor: "test",
            validate: async (value) =>
                (value as { ok?: unknown })?.ok === true ? { value: { ok: true } } : { issues: [{ message: "ok が true ではない" }] },
        },
    };

    test("非同期のスキーマ", async () => {
        const app = createApp();
        app.post("/", { body: asyncSchema }, (_, c) => c.valid("body"));
        expect((await app.fetch(json("/", { ok: true }))).status).toBe(200);
        expect((await app.fetch(json("/", { ok: false }))).status).toBe(400);
    });

    test("app.on・router・app.route でも使える", async () => {
        const app = createApp();
        app.on("QUERY", "/search", { body: z.object({ q: z.string() }) }, (_, c) => c.valid("body").q);
        const users = createRouter("/users/:id");
        users.get("/posts", { params: z.object({ id: z.coerce.number() }) }, ({ id }) => ({ id }));
        app.route(users);

        const search = await app.fetch(json("/search", { q: "senri" }, "QUERY"));
        expect(await search.text()).toBe("senri");
        expect(await (await app.fetch(req("/users/7/posts"))).json()).toEqual({ id: 7 });
        expect((await app.fetch(req("/users/x/posts"))).status).toBe(400);
    });

    test("フォームのボディも確かめられる", async () => {
        const app = createApp();
        app.post("/", { body: z.object({ name: z.string() }) }, (_, c) => c.valid("body").name);
        const res = await app.fetch(
            req("/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=yahari" }),
        );
        expect(await res.text()).toBe("yahari");
    });

    test("ミドルウェアは、バリデーションより先に動く(認証で弾ける)", async () => {
        const app = createApp();
        const order: string[] = [];
        app.use(async (_c, next) => {
            order.push("mw");
            return next();
        });
        app.post("/", { body: z.object({ n: z.number() }) }, () => "ok");
        await app.fetch(json("/", { n: "x" }));
        expect(order).toEqual(["mw"]);
    });
});

describe("登録時のチェック", () => {
    test("スキーマでないものや、知らないキーはエラー", () => {
        const app = createApp();
        expect(() => app.post("/", { body: {} } as never, () => "x")).toThrow("Standard Schema");
        expect(() => app.post("/", { json: z.string() } as never, () => "x")).toThrow("params / query / body");
        expect(() => app.post("/", { body: z.string() } as never)).toThrow("ハンドラーがありません");
    });

    test("スキーマを渡していないものを c.valid() で読むと、分かりやすいエラー", async () => {
        const app = createApp({ dev: true });
        app.get("/", (_, c) => (c as never as { valid(t: string): unknown }).valid("body") as string);
        const res = await app.fetch(req("/"));
        expect(res.status).toBe(500);
        expect(await res.text()).toContain('c.valid("body") の値がありません');
    });
});
