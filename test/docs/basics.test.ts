// ドキュメントの「バリデーション」「ミドルウェア」「エラー処理」に書いた動き
import { expect } from "bun:test";
import { z } from "zod";
import { createApp, defineRoutes, endpoint, HttpError, ValidationError } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { ProblemError, problem, problemDetails } from "../../src/problem.ts";
import { claim, quiet, req } from "./claim.ts";

const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { "content-type": "application/json" } });

// ---------- validation ----------
{
    const app = createApp();
    app.post("/users/:id", { params: z.object({ id: z.coerce.number() }), body: z.object({ name: z.string().min(1) }) }, ({ id }, c) => ({ id, name: c.valid("body").name }));
    claim("validation#params-converted", "params が通ると、1 つ目の引数が変換したあとの値になる", async () => {
        expect(await (await req(app, "POST", "/users/1", json({ name: "a" }))).json()).toEqual({ id: 1, name: "a" });
    });
    claim("validation#400-production", "通らなければ 400。本番の本文は 400 Bad Request だけ", async () => {
        const r = await req(app, "POST", "/users/1", json({ name: "" }));
        expect([r.status, await r.text()]).toEqual([400, "400 Bad Request"]);
    });
    claim("validation#400-dev", "開発モードでは、どこが違うかを一覧にする", async () => {
        const dev = createApp({ dev: devtools({ lang: "ja" }) });
        dev.post("/u", { body: z.object({ name: z.string() }) }, () => "ok");
        const r = await req(dev, "POST", "/u", json({}));
        expect(r.status).toBe(400);
        expect((await r.text()).length).toBeGreaterThan("400 Bad Request".length);
    });
    claim("validation#on-error", "app.onError で ValidationError を受ける(target と issues)", async () => {
        const a = createApp();
        a.post("/u", { body: z.object({ name: z.string() }) }, () => "ok");
        a.onError((err, c) => {
            if (err instanceof ValidationError) {
                c.status(422);
                return { target: err.target, issues: err.issues.map((i) => i.message) };
            }
            throw err;
        });
        const r = await req(a, "POST", "/u", json({}));
        const j = await r.json();
        expect(r.status).toBe(422);
        expect(j.target).toBe("body");
        expect(j.issues.length).toBeGreaterThan(0);
    });
}

// ---------- middleware/writing ----------
{
    const app = createApp();
    app.use(async (c, next) => {
        const res = await next();
        c.header("x-response-time", "1ms");
        return res;
    });
    app.use("/admin", (c, next) => {
        if (c.req.headers.get("authorization") !== "secret") {
            c.status(401);
            return "ログインしてね";
        }
        return next();
    });
    app.get("/admin", () => "admin");
    app.get("/admin/x", () => "x");
    claim("middleware/writing#after-next", "next() のあとに足したヘッダーが付く", async () => {
        expect((await req(app, "GET", "/admin", { headers: { authorization: "secret" } })).headers.get("x-response-time")).toBe("1ms");
    });
    claim("middleware/writing#return-stops", "値を返したらそこで終わり(後ろは動かない)", async () => {
        const r = await req(app, "GET", "/admin");
        expect([r.status, await r.text()]).toEqual([401, "ログインしてね"]);
    });
    claim("middleware/writing#path", "app.use(\"/admin\", mw) は /admin とその下で動く", async () => {
        expect((await req(app, "GET", "/admin/x")).status).toBe(401);
    });
    claim("middleware/writing#onion", "登録した順に入り、逆の順に出る", async () => {
        const a = createApp();
        const order: string[] = [];
        a.use(async (_, next) => {
            order.push("1 in");
            await next();
            order.push("1 out");
        });
        a.use(async (_, next) => {
            order.push("2 in");
            await next();
            order.push("2 out");
        });
        a.get("/", () => (order.push("handler"), "x"));
        await req(a, "GET", "/");
        expect(order).toEqual(["1 in", "2 in", "handler", "2 out", "1 out"]);
    });
    claim("middleware/writing#set-get", "c.set() で渡した値を c.get() で読む", async () => {
        const a = createApp<{ user: { name: string } }>();
        a.use("/me", async (c, next) => {
            c.set("user", { name: "alice" });
            await next();
        });
        a.get("/me", (_, c) => ({ name: c.get("user")?.name }));
        expect(await (await req(a, "GET", "/me")).json()).toEqual({ name: "alice" });
    });
}

// ---------- middleware/route-middleware ----------
claim("middleware/route-middleware#order", "app.use → 表の use → ルートの use → スキーマ → ハンドラー", async () => {
    const order: string[] = [];
    const app = createApp();
    app.use(async (_, next) => {
        order.push("app");
        await next();
    });
    app.routes(
        defineRoutes("", {
            use: [
                async (_, next) => {
                    order.push("table");
                    await next();
                },
            ],
        })({
            "POST /t": endpoint(
                {
                    use: [
                        async (_, next) => {
                            order.push("route");
                            await next();
                        },
                    ],
                    body: z.object({ a: z.number() }).transform((v) => (order.push("schema"), v)),
                },
                () => (order.push("handler"), "ok"),
            ),
        }),
    );
    await req(app, "POST", "/t", json({ a: 1 }));
    expect(order).toEqual(["app", "table", "route", "schema", "handler"]);
});
claim("middleware/route-middleware#stop-before-body", "ミドルウェアが値を返したら、スキーマの確認(本文を読む)の前に止まる", async () => {
    let parsed = false;
    const app = createApp();
    app.routes(
        defineRoutes({
            "POST /t": endpoint({ use: [(c) => (c.status(401), "no")], body: z.object({ a: z.number() }).transform((v) => ((parsed = true), v)) }, () => "ok"),
        }),
    );
    const r = await req(app, "POST", "/t", json({ a: 1 }));
    expect(r.status).toBe(401);
    expect(parsed).toBe(false);
});
claim("middleware/route-middleware#only-matched", "表とルートの use は、そのルートに当たったリクエストでだけ動く", async () => {
    let calls = 0;
    const app = createApp();
    app.routes(
        defineRoutes("/admin", {
            use: [
                async (_, next) => {
                    calls++;
                    await next();
                },
            ],
        })({ "GET /me": () => "me" }),
    );
    app.get("/other", () => "o");
    await req(app, "GET", "/other");
    await req(app, "GET", "/admin/none");
    expect(calls).toBe(0);
    await req(app, "GET", "/admin/me");
    expect(calls).toBe(1);
});

// ---------- errors/http-error ----------
{
    const app = createApp();
    app.get("/secret", () => {
        throw new HttpError(403, "見せられません");
    });
    app.get("/boom", () => {
        throw new Error("内部");
    });
    claim("errors/http-error#message", "HttpError の message はそのまま返す", async () => {
        const r = await req(app, "GET", "/secret");
        expect([r.status, await r.text()]).toEqual([403, "見せられません"]);
    });
    claim("errors/http-error#other-500", "HttpError でないエラーは 500 Internal Server Error とだけ返す", async () => {
        const r = await quiet(() => req(app, "GET", "/boom"));
        expect([r.status, await r.text()]).toEqual([500, "500 Internal Server Error"]);
    });
}

// ---------- errors/on-error ----------
claim("errors/on-error#status", "HttpError ならその status、それ以外は 500", async () => {
    const app = createApp();
    app.get("/h", () => {
        throw new HttpError(409, "c");
    });
    app.get("/e", () => {
        throw new Error("x");
    });
    app.onError((err) => (err instanceof HttpError ? { error: err.message } : { error: "something went wrong" }));
    expect((await req(app, "GET", "/h")).status).toBe(409);
    expect((await quiet(() => req(app, "GET", "/e"))).status).toBe(500);
});
claim("errors/on-error#throw-inside", "onError の中で投げると、固定の 500", async () => {
    const app = createApp();
    app.get("/e", () => {
        throw new Error("x");
    });
    app.onError(() => {
        throw new Error("again");
    });
    const r = await quiet(() => req(app, "GET", "/e"));
    expect([r.status, await r.text()]).toEqual([500, "500 Internal Server Error"]);
});

// ---------- errors/not-found ----------
{
    const app = createApp();
    let seen = 0;
    app.use(async (_, next) => {
        const res = await next();
        seen = (res as Response).status;
        return res;
    });
    app.use(async (c, next) => {
        c.header("x-keep", "1");
        await next();
    });
    app.notFound((c) => `ありません: ${c.path}`);
    app.get("/items/:id", (_, c) => c.notFound());
    claim("errors/not-found#handler", "ルートがなければ、app.notFound のハンドラー", async () => {
        const r = await req(app, "GET", "/none");
        expect([r.status, await r.text()]).toEqual([404, "ありません: /none"]);
    });
    claim("errors/not-found#c-not-found", "c.notFound() で同じところに回す", async () => {
        expect(await (await req(app, "GET", "/items/1")).text()).toBe("ありません: /items/1");
    });
    claim("errors/not-found#next-returns", "外側の next() は投げずに 404 のレスポンスを返す", async () => {
        await req(app, "GET", "/items/1");
        expect(seen).toBe(404);
    });
    claim("errors/not-found#headers-kept", "c.header() のヘッダーは 404 にも付く", async () => {
        expect((await req(app, "GET", "/items/1")).headers.get("x-keep")).toBe("1");
    });
    claim("errors/not-found#mounted", "app.route() でつないだアプリから呼んでも、親のハンドラー", async () => {
        const parent = createApp();
        parent.notFound(() => "parent");
        const child = createApp();
        child.get("/x", (_, c) => c.notFound());
        parent.route("/child", child);
        expect(await (await req(parent, "GET", "/child/x")).text()).toBe("parent");
    });
    claim("errors/not-found#inside-handlers", "notFound の中では既定の 404、onError の中では固定の 500", async () => {
        const a = createApp();
        a.notFound((c) => c.notFound());
        const r = await req(a, "GET", "/none");
        expect([r.status, await r.text()]).toEqual([404, "404 Not Found"]);
        const b = createApp();
        b.get("/e", () => {
            throw new Error("x");
        });
        b.onError((_, c) => c.notFound());
        expect((await quiet(() => req(b, "GET", "/e"))).status).toBe(500);
    });
}

// ---------- errors/problem-details ----------
{
    const app = createApp();
    const problems = problemDetails();
    app.onError(problems.onError);
    app.notFound(problems.notFound);
    app.post("/transfer", () => {
        throw new ProblemError(403, {
            type: "https://example.com/probs/out-of-credit",
            title: "You do not have enough credit.",
            detail: "Your current balance is 30, but that costs 50.",
            extensions: { balance: 30 },
        });
    });
    app.get("/legacy", (_, c) => problem(c, { status: 410, detail: "Use /v2 instead." }));
    app.get("/boom", () => {
        throw new Error("secret");
    });
    app.post("/only-post", () => "x");
    claim("errors/problem-details#json", "ページの JSON のとおり(extensions は外に出る)", async () => {
        const r = await req(app, "POST", "/transfer");
        expect(r.headers.get("content-type")).toStartWith("application/problem+json");
        expect(await r.json()).toEqual({ type: "https://example.com/probs/out-of-credit", title: "You do not have enough credit.", status: 403, detail: "Your current balance is 30, but that costs 50.", balance: 30 });
    });
    claim("errors/problem-details#defaults", "type を省くと about:blank、title は status の名前", async () => {
        expect(await (await req(app, "GET", "/legacy")).json()).toEqual({ type: "about:blank", title: "Gone", status: 410, detail: "Use /v2 instead." });
        expect(await (await req(app, "GET", "/none")).json()).toEqual({ type: "about:blank", title: "Not Found", status: 404 });
    });
    claim("errors/problem-details#http-error", "status だけの message なら detail を付けず、Allow などのヘッダーは残る", async () => {
        const r = await req(app, "GET", "/only-post");
        expect(r.status).toBe(405);
        expect(r.headers.get("allow")).toContain("POST");
        expect((await r.json()).detail).toBeUndefined();
    });
    claim("errors/problem-details#other-500", "HttpError でないエラーは title だけの 500", async () => {
        const r = await quiet(() => req(app, "GET", "/boom"));
        expect(await r.json()).toEqual({ type: "about:blank", title: "Internal Server Error", status: 500 });
    });
    claim("errors/problem-details#plain-http-error", "problemDetails() を使わないアプリでは、ProblemError はテキストのエラー", async () => {
        const a = createApp();
        a.get("/", () => {
            throw new ProblemError(403, { title: "T", detail: "D" });
        });
        const r = await req(a, "GET", "/");
        expect([r.status, await r.text()]).toEqual([403, "D"]);
    });
}
