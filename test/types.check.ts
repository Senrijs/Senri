// 型だけのテスト。bun test では実行せず、bun check(bun run typecheck)で確かめる
// 「ts-expect-error」のコメントは、次の行が型エラーになることを期待する。エラーにならなければ、そちらがエラーになる
import { type } from "arktype";
import { client, type ClientData, type ClientResultOf, type SuccessStatus } from "../src/client.ts";
import { request, testClient } from "../src/testing.ts";
import * as v from "valibot";
import { z } from "zod";
import {
    createApp,
    defineRoutes,
    endpoint,
    mergeRoutes,
    logger,
    type Context,
    type ExecutionContext,
    type Middleware,
    type RedirectStatus,
    type StandardSchemaV1,
    type RouteTable,
} from "../src/index.ts";

const app = createApp();

// --- ハンドラーの戻り値(項目13) ---

// 関数を返す(呼び忘れ)のは型エラー
// @ts-expect-error
app.get("/fn", () => () => 1);
// async でも同じ
// @ts-expect-error
app.get("/fn-async", async () => () => 1);

// これらは返してよい
app.get("/text", () => "text");
app.get("/json", () => ({ a: 1 }));
app.get("/array", () => [1, 2, 3]);
app.get("/blob", () => new Blob(["x"]));
app.get("/bytes", () => new Uint8Array([1, 2]));
app.get("/stream", () => new ReadableStream());
app.get("/form", () => new FormData());
app.get("/search", () => new URLSearchParams({ q: "x" }));
app.get("/async-json", async () => ({ a: 1 }));

// --- レスポンスのヘルパー ---

// c.redirect() の status は5つだけ
app.get("/r1", (_, c) => c.redirect("/x"));
app.get("/r2", (_, c) => c.redirect("/x", 301));
app.get("/r3", (_, c) => c.redirect("/x", 302));
app.get("/r4", (_, c) => c.redirect("/x", 303));
app.get("/r5", (_, c) => c.redirect("/x", 307));
app.get("/r6", (_, c) => c.redirect("/x", 308));
const redirectStatus: RedirectStatus = 301;
app.get("/r7", (_, c) => c.redirect("/x", redirectStatus));
// @ts-expect-error リダイレクトの status ではない
app.get("/r8", (_, c) => c.redirect("/x", 200));
// @ts-expect-error 304 はリダイレクトではない
app.get("/r9", (_, c) => c.redirect("/x", 304));
// @ts-expect-error ただの number は渡せない
app.get("/r10", (_, c) => c.redirect("/x", 300 + 2));
// @ts-expect-error location は文字列
app.get("/r11", (_, c) => c.redirect(new URL("http://localhost/")));

app.get("/h1", (_, c) => c.html("<p/>"));
app.get("/h2", (_, c) => c.html("<p/>", 404));
// @ts-expect-error body は文字列
app.get("/h3", (_, c) => c.html(new Uint8Array([1])));

// --- c.notFound() ---

const stock = new Map<string, { name: string }>();

// 標準の書き方は return c.notFound()。そのあとは undefined が消える
app.get("/nf1/:id", ({ id }, c) => {
    const item = stock.get(id);
    if (!item) return c.notFound();
    return item.name;
});
app.get("/nf2", (_, c) => c.notFound());
app.get("/nf3", async (_, c) => c.notFound());
app.get("/nf4/:id", ({ id }, c) => {
    const item = stock.get(id);
    if (!item) throw c.notFound();
    return item.name;
});
app.use((c, next) => {
    if (c.path === "/hidden") return c.notFound();
    return next();
});

// 戻り値は never
function notFoundIsNever(c: Context) {
    const value: never = c.notFound();
    return value;
}
void notFoundIsNever;

// TypeScript の制限: c に型を明示していないと(ふつうの書き方)、c.notFound() だけでは「止まる」と扱われない
// never の呼び出しで処理の流れが変わるのは、呼び出す先の名前すべてに型の明示があるときだけ。Senri の側では直せない
app.get("/nf5/:id", ({ id }, c) => {
    const item = stock.get(id);
    if (!item) c.notFound();
    // @ts-expect-error item が undefined のままになる
    return item.name;
});
// @ts-expect-error 最後まで流れるとみなされて、戻り値が void になる
app.get("/nf6", (_, c) => {
    c.notFound();
});
// @ts-expect-error async でも同じ
app.get("/nf7", async (_, c) => {
    c.notFound();
});

// --- ワイルドカード ---

// 残りのパスは "*" で、string として受け取れる
app.get("/w1/*", ({ "*": rest }) => {
    const value: string = rest;
    return value;
});
app.get("/w2/:id/*", ({ id, "*": rest }) => `${id} ${rest}`);
app.get("/*", (params) => params["*"]);
app.on(["GET", "POST"], "/w3/*", ({ "*": rest }) => rest);
app.routes({ "GET /w4/*": ({ "*": rest }) => rest });

const wildRouter = createRouter("/w5/:id");
wildRouter.get("/*", ({ id, "*": rest }) => `${id} ${rest}`);
wildRouter.get("*", ({ "*": rest }) => rest);

// ワイルドカードがなければ読めない
// @ts-expect-error
app.get("/w6", ({ "*": rest }) => rest);
// @ts-expect-error
app.get("/w7/:id", ({ "*": rest }) => rest);

// スキーマを渡せば、その型になる
const wildSchema: StandardSchemaV1<unknown, { "*": string; n: number }> = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: { "*": "a", n: 1 } }) },
};
app.get("/w8/:n/*", { params: wildSchema }, ({ n, "*": rest }) => `${n + 1} ${rest}`);

// 途中の * は型では止めない(登録時のエラーになる。test/wildcard.test.ts)
const midWildcard = () => app.get("/w9/*/c", ({ "*": rest }) => rest);
void midWildcard;

// c に型を明示すれば、c.notFound() だけでも「止まる」と扱われる
app.get("/nf8/:id", ({ id }, c: Context) => {
    const item = stock.get(id);
    if (!item) c.notFound();
    return item.name;
});
app.get("/nf9", (_, c: Context) => {
    c.notFound();
});

// 絞り込みが要らなければ、c.notFound() だけでも問題ない
app.get("/nf10/:id", ({ id }, c) => {
    if (!stock.has(id)) c.notFound();
    return "ok";
});
app.use((c, next) => {
    if (c.path === "/hidden") c.notFound();
    return next();
});
app.use((c) => {
    c.notFound();
});

// --- app.routes() のテーブル形式(項目14) ---

app.routes({
    // キーのパスから、パラメーターが推論される
    "GET /u/:id": ({ id }) => id,
    "POST /u/:id/posts/:postId": ({ id, postId }) => `${id} ${postId}`,
    "GET /plain": () => "ok",
});

app.routes({
    // @ts-expect-error パスにないパラメーターは使えない
    "GET /v/:id": ({ nope }) => nope,
});

app.routes({
    // @ts-expect-error メソッドとパスの間にスペースがない
    "GET/hello": () => "x",
});

// --- パスパラメーターの推論(項目15) ---

// 静的セグメントの途中にある ":" はパラメーターではない(実行時と同じ)
app.get("/time/12:00", (p) => {
    // @ts-expect-error "00" というパラメーターはない
    p["00"];
    return "ok";
});

// パスが string 型(リテラルでない)なら、どんな名前でも string として読める
const dynamicPath: string = "/dyn/:id";
app.get(dynamicPath, (p) => {
    const id: string | undefined = p.id;
    return id ?? "none";
});

// 末尾スラッシュがあっても推論できる
app.get("/trailing/:id/", ({ id }) => id);

// --- c.set / c.get(項目19) ---

type User = { name: string };
const typed = createApp<{ user: User; requestId: string }>();

// 汎用のミドルウェア(logger など)はそのまま使える
typed.use(logger());
typed.use((c, next) => {
    c.set("user", { name: "yahari" });
    return next();
});
typed.use((c, next) => {
    // @ts-expect-error 型が違う
    c.set("user", 1);
    return next();
});
typed.use((c, next) => {
    // @ts-expect-error 知らないキー
    c.set("nope", 1);
    return next();
});
typed.get("/me", (_, c) => {
    // 入っていないこともあるので undefined がつく
    const user: User | undefined = c.get("user");
    return user?.name ?? "anonymous";
});

// interface で書いても使える
interface Vars {
    user: User;
}
const withInterface = createApp<Vars>();
withInterface.use(logger());
withInterface.get("/me", (_, c) => c.get("user")?.name ?? "anonymous");

// 外で定義したミドルウェアも使える
const standalone: Middleware = (_c, next) => next();
typed.use(standalone);

// --- ルートのグループ化 ---

import { createRouter } from "../src/index.ts";

const usersRouter = createRouter("/users/:id");
// プレフィックスのパラメーターも推論される
usersRouter.get("/posts/:postId", ({ id, postId }) => `${id}${postId}`);
// @ts-expect-error プレフィックスにもパスにもないパラメーター
usersRouter.get("/", ({ nope }) => nope);
app.route(usersRouter);

// --- app.on / head / options ---

app.on("QUERY", "/q/:id", ({ id }) => id);
app.on(["GET", "POST"], "/multi/:id", ({ id }) => id);
// @ts-expect-error パスにないパラメーター
app.on("PROPFIND", "/dav/:name", ({ nope }) => nope);
app.head("/h/:id", ({ id }) => id);
app.options("/o/:id", ({ id }) => id);
usersRouter.on("QUERY", "/search", ({ id }) => id);
// 別のアプリをプレフィックス付きでつなぐ(中のハンドラーでは、プレフィックスのパラメーターに型は付かない)
const subApp = createApp();
// c.params から読む
subApp.get("/posts", (_, c) => c.params.id ?? "none");
app.route("/users/:id", subApp);
// @ts-expect-error プレフィックスなしでアプリは渡せない
app.route(subApp);

// --- Cloudflare Workers(c.env / c.executionCtx) ---

type Env = { GREETING: string; COUNT: number };
const worker = createApp<{ Bindings: Env; Variables: { user: string } }>();
worker.use(async (c, next) => {
    c.set("user", c.env.GREETING);
    // @ts-expect-error Variables にない名前
    c.set("nope", 1);
    return next();
});
worker.get("/", (_, c) => {
    const greeting: string = c.env.GREETING;
    const count: number = c.env.COUNT;
    // @ts-expect-error Bindings にない名前
    c.env.MISSING;
    const user: string | undefined = c.get("user");
    c.executionCtx.waitUntil(Promise.resolve());
    return `${greeting} ${count} ${user}`;
});
// export default app で、Workers の ExportedHandler の fetch(req, env, ctx) として渡せる
const exported: { fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> } = worker;
void exported;

// Bindings だけ指定したときは、変数は今までどおり何でも入れられる
const onlyBindings = createApp<{ Bindings: Env }>();
onlyBindings.get("/", (_, c) => {
    c.set("anything", 1);
    return c.env.GREETING;
});

// 以前からの書き方(変数の型だけ)はそのまま使える。c.env は分からないので unknown
const varsOnly = createApp<{ user: string }>();
varsOnly.get("/", (_, c) => {
    c.set("user", "a");
    // @ts-expect-error env の中身は分からない
    c.env.GREETING;
    return c.get("user") ?? "";
});

// --- Standard Schema によるバリデーション ---

const zBody = z.object({ name: z.string(), age: z.number() });
app.post("/v/:id", { params: z.object({ id: z.coerce.number() }), body: zBody }, ({ id }, c) => {
    // params のスキーマの変換後の型
    const n: number = id;
    const body: { name: string; age: number } = c.valid("body");
    // @ts-expect-error query のスキーマは渡していない
    c.valid("query");
    return { n, body };
});
// params のスキーマがなければ、今までどおりパスから取り出した型
app.post("/v2/:slug", { query: v.object({ q: v.string() }) }, ({ slug }, c) => {
    const s: string = slug;
    const q: string = c.valid("query").q;
    return s + q;
});
// @ts-expect-error params のスキーマがなければ、パスにないパラメーターは型エラー
app.post("/v2b/:slug", { query: v.object({ q: v.string() }) }, ({ nope }) => nope);
app.put("/v3", { body: type({ ok: "boolean" }) }, (_, c) => {
    const ok: boolean = c.valid("body").ok;
    return { ok };
});
app.on("QUERY", "/v4", { body: zBody }, (_, c) => c.valid("body").name);
usersRouter.post("/v5", { body: zBody }, ({ id }, c) => `${id} ${c.valid("body").age}`);
// スキーマのないルートでは c.valid は何も読めない
app.get("/v6", (_, c) => {
    // @ts-expect-error スキーマを渡していない
    c.valid("body");
    return "x";
});

// --- defineRoutes() / endpoint() / mergeRoutes() ---

// 型が同じかを確かめる(違えば、代入の行がエラーになる)
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const same = <A, B>(ok: Same<A, B>) => ok;

const userSchema = z.object({ name: z.string() });
const idSchema = z.object({ id: z.coerce.number() });

const table = defineRoutes({
    // キーのパスから、パラメーターが推論される
    "GET /users/:id": ({ id }) => ({ id, upper: id.toUpperCase() }),
    // スキーマ付き: c.valid() に型が付く
    "POST /users": endpoint({ body: userSchema }, (_, c) => ({ created: c.valid("body").name })),
    // params のスキーマがあれば、その出力の型
    "GET /items/:id": endpoint({ params: idSchema }, ({ id }) => ({ next: id + 1 })),
    "GET /text": () => "hi",
});
// キーと、ハンドラーの戻り値の型が残る
same<keyof typeof table, "GET /users/:id" | "POST /users" | "GET /items/:id" | "GET /text">(true);
same<ReturnType<(typeof table)["GET /users/:id"]>, { id: string; upper: string }>(true);
same<ReturnType<(typeof table)["POST /users"]["handler"]>, { created: string }>(true);
same<ReturnType<(typeof table)["GET /items/:id"]["handler"]>, { next: number }>(true);

// 前置きは 2 段。前置きのパラメーターも、中のハンドラーで型が付く
const orgs = defineRoutes("/orgs/:orgId")({
    "GET /": ({ orgId }) => orgId,
    "GET /members/:memberId": ({ orgId, memberId }) => ({ orgId, memberId }),
    "POST /members": endpoint({ body: userSchema }, ({ orgId }, c) => `${orgId} ${c.valid("body").name}`),
});
same<keyof typeof orgs, "GET /orgs/:orgId" | "GET /orgs/:orgId/members/:memberId" | "POST /orgs/:orgId/members">(true);

// mergeRoutes() の型は、表を合わせたもの
const merged = mergeRoutes(table, orgs);
same<keyof typeof merged, keyof typeof table | keyof typeof orgs>(true);

// app.routes() に渡せる
app.routes(table);
app.routes(merged);

// c.get() の型は、前置きと一緒にアプリの型を渡すと付く
const admin = defineRoutes<"/admin", { user: { name: string } }>("/admin")({
    "GET /me": (_, c) => c.get("user")?.name ?? "",
});
same<ReturnType<(typeof admin)["GET /admin/me"]>, string>(true);

defineRoutes({
    // @ts-expect-error パスにないパラメーターは使えない
    "GET /x/:id": ({ nope }) => nope,
});
defineRoutes("/orgs/:orgId")({
    // @ts-expect-error 前置きにないパラメーターは使えない
    "GET /x": ({ teamId }) => teamId,
});
// @ts-expect-error メソッドとパスの間にスペースがない(エラーは呼び出しの行に出る)
defineRoutes({
    "GET/x": () => "x",
});
defineRoutes({
    // @ts-expect-error スキーマを渡していないものは c.valid() で読めない
    "POST /x": endpoint({ body: userSchema }, (_, c) => c.valid("query")),
});
// @ts-expect-error 関数を返す(呼び忘れ)のは型エラー(エラーは呼び出しの行に出る)
defineRoutes({
    "GET /fn": () => () => 1,
});

// --- ルートごとのミドルウェア(use) ---

declare const authUser: Middleware<{ user: { name: string } }>;
declare const withTenant: Middleware<{ tenant: string }>;

// endpoint() の use: ミドルウェアが c.set() する変数に、型が付く
const withUse = defineRoutes({
    "GET /me": endpoint({ use: [authUser] }, (_, c) => c.get("user")?.name ?? ""),
    // use とスキーマを一緒に
    "POST /posts": endpoint({ use: [authUser, withTenant], body: userSchema }, (_, c) => ({
        by: c.get("user")?.name ?? "",
        tenant: c.get("tenant") ?? "",
        title: c.valid("body").name,
    })),
});
same<ReturnType<(typeof withUse)["GET /me"]["handler"]>, string>(true);
same<ReturnType<(typeof withUse)["POST /posts"]["handler"]>, { by: string; tenant: string; title: string }>(true);

// 表の use: 表の全部のルートで、変数に型が付く。ハンドラーだけの値も endpoint() の形になる
const adminTable = defineRoutes("/admin", { use: [authUser] })({
    "GET /me": (_, c) => c.get("user")?.name ?? "",
    "GET /tenant": endpoint({ use: [withTenant] }, (_, c) => `${c.get("user")?.name} ${c.get("tenant")}`),
});
same<keyof typeof adminTable, "GET /admin/me" | "GET /admin/tenant">(true);
same<ReturnType<(typeof adminTable)["GET /admin/me"]["handler"]>, string>(true);
app.routes(adminTable);

// 型を決めていないミドルウェア(logger() など)を並べても、型は壊れない
defineRoutes({ "GET /log": endpoint({ use: [logger()] }, () => "ok") });

// --- 型付きクライアント(@senrijs/senri/client) ---

const clientRoutes = defineRoutes({
    "GET /users/:id": ({ id }) => ({ id, at: new Date(), tags: new Set<string>(), note: undefined as string | undefined, skip: () => 1 }),
    "POST /users": endpoint({ body: userSchema, query: z.object({ dry: z.string().optional() }) }, (_, c) => ({ created: c.valid("body").name })),
    "GET /text": () => "hi",
    "GET /bytes": () => new Uint8Array([1]),
    "GET /raw": () => new Response("x"),
    "GET /async": async () => [1, 2] as const,
});
const typedApi = client<typeof clientRoutes>("https://example.com");

async function clientTypes() {
    const user = await typedApi("GET /users/:id", { params: { id: "1" } });
    if (user.ok) {
        // JSON にしたあとの形: Date → string、Set → {}、undefined になりうるものは省略可能、関数は消える
        same<typeof user.data, { id: string; at: string; tags: {}; note?: string }>(true);
    } else {
        same<typeof user.error, unknown>(true);
    }
    same<Awaited<ReturnType<typeof typedApi<"GET /text">>>, ClientResultOf<typeof clientRoutes, "GET /text">>(true);
    same<ClientData<typeof clientRoutes, "GET /bytes">, Blob>(true);
    same<ClientData<typeof clientRoutes, "GET /raw">, unknown>(true);
    same<ClientData<typeof clientRoutes, "GET /async">, readonly [1, 2]>(true);

    // 何も要らないルートは、2 つ目の引数を省ける
    await typedApi("GET /text");
    // ボディはスキーマの入力の型。クエリもスキーマがあればその型
    await typedApi("POST /users", { body: { name: "a" }, query: { dry: "1" } });
    // パラメーターは数でもよい(文字列にして送る)
    await typedApi("GET /users/:id", { params: { id: 1 } });

    // @ts-expect-error パラメーターが要るルートは、省けない
    await typedApi("GET /users/:id");
    // @ts-expect-error パラメーターの名前違い
    await typedApi("GET /users/:id", { params: { userId: "1" } });
    // @ts-expect-error ボディのスキーマがあるルートは、ボディを省けない
    await typedApi("POST /users", {});
    // @ts-expect-error ボディの型が違う
    await typedApi("POST /users", { body: { name: 1 } });
    // @ts-expect-error 表にないルート
    await typedApi("GET /nope");
}
void clientTypes;

// --- テスト用ヘルパー(@senrijs/senri/testing) ---

async function testingTypes() {
    // testClient は、型付きクライアントと同じ型
    const t = testClient<typeof clientRoutes>(app, { cookies: true, ip: "10.0.0.1" });
    const res = await t("GET /users/:id", { params: { id: "1" } });
    if (res.ok) same<typeof res.data.id, string>(true);
    // @ts-expect-error 表にないルート
    await t("GET /nope");
    // request は Response を返す
    same<Awaited<ReturnType<typeof request>>, Response>(true);
}
void testingTypes;

// --- OpenAPI 用の項目(endpoint の response / responses / bodyType / openapi) ---

defineRoutes({
    "GET /doc/:id": endpoint(
        { response: userSchema, responses: { 404: userSchema }, bodyType: "json", openapi: { summary: "s", tags: ["t"], security: [{ bearer: [] }] } },
        ({ id }) => ({ name: id }),
    ),
});
defineRoutes({
    // @ts-expect-error bodyType は "json" か "form"
    "POST /doc": endpoint({ bodyType: "xml" }, () => "x"),
});
defineRoutes({
    // @ts-expect-error openapi の項目の型が違う
    "GET /doc2": endpoint({ openapi: { tags: "t" } }, () => "x"),
});

// --- status ごとの型(c.json(body, status) と endpoint({ response, responses })) ---

const notFound = z.object({ message: z.string() });
const statusRoutes = defineRoutes({
    // 成功はふつうに返し、見つからなければ c.json(..., 404)
    "GET /s/users/:id": ({ id }, c) => (id === "0" ? c.json({ message: "not found" }, 404) : { id, at: new Date() }),
    // c.text(..., 400) はテキストの error。c.json(..., 201) は成功に入る
    "POST /s/users": (_, c) => (Math.random() > 0.5 ? c.text("bad", 400) : c.json({ created: true }, 201)),
    // response / responses のスキーマ。data はスキーマの出力の型(ハンドラーの戻り値より優先)
    "GET /s/items/:id": endpoint({ response: z.object({ name: z.string() }), responses: { 404: notFound } }, () => ({ name: "a" })),
    // status を書かない c.json() は 200 として成功
    "GET /s/plain": (_, c) => c.json({ ok: 1 }),
});
const statusApi = client<typeof statusRoutes>("https://example.com");

async function statusTypes() {
    const user = await statusApi("GET /s/users/:id", { params: { id: "1" } });
    if (user.ok) {
        same<typeof user.data, { id: string; at: string }>(true);
    } else if (user.status === 404) {
        // 書いた status は、error に型が付く
        same<typeof user.error, { message: string }>(true);
    } else {
        // 書いていない status(onError・ミドルウェア・notFound)は unknown
        same<typeof user.error, unknown>(true);
    }

    const created = await statusApi("POST /s/users");
    if (created.ok) same<typeof created.data, { created: boolean }>(true);
    else if (created.status === 400) same<typeof created.error, string>(true);

    const item = await statusApi("GET /s/items/:id", { params: { id: "1" } });
    if (item.ok) same<typeof item.data, { name: string }>(true);
    else if (item.status === 404) same<typeof item.error, { message: string }>(true);

    const plain = await statusApi("GET /s/plain");
    if (plain.ok) same<typeof plain.data, { ok: number }>(true);

    // ok の status は 2xx の型
    if (user.ok) same<typeof user.status, SuccessStatus>(true);
}
void statusTypes;

// c.json() / c.text() の戻り値は Response としても使える
app.get("/s/as-response", (_, c) => {
    const res: Response = c.json({ a: 1 }, 404);
    return res;
});

// RouteTable は表の形(0.3.0)。型を書くときは、表の型を渡す
const inlineTable = { "GET /rt/:id": ({ id }: { id: string }) => id } as const;
const checked: RouteTable<typeof inlineTable> = inlineTable;
void checked;
