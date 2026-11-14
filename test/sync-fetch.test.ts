// app.fetch は、同期で答えられるときは Response をそのまま返し、それ以外は Promise を返す
// どちらの場合も、応答の中身は同じ(ミドルウェアを 1 つ挟んで Promise の道を通したものと比べる)
import { describe, expect, test } from "bun:test";
import { createApp, HttpError, type App } from "../src/index.ts";
import { setCookie } from "../src/cookie.ts";
import { devtools } from "../src/dev/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

// 比べる形。ヘッダーは名前順に並べる
async function snapshot(res: Response) {
    return {
        status: res.status,
        headers: [...res.headers].sort(([a], [b]) => a.localeCompare(b)),
        cookies: res.headers.getSetCookie(),
        body: await res.text(),
    };
}

function addRoutes(app: App<any>) {
    app.get("/", () => "hi");
    app.get("/json", () => ({ a: 1 }));
    app.get("/users/:id", ({ id }) => ({ id }));
    app.get("/status", (_, c) => {
        c.status(201).header("x-mark", "1");
        return "created";
    });
    app.get("/cookies", (_, c) => {
        setCookie(c, "a", "1");
        setCookie(c, "b", "2");
        return "ok";
    });
    app.get("/type", (_, c) => {
        c.header("content-type", "text/html");
        return "<p/>";
    });
    app.get("/c-text", (_, c) => c.text("t", 200));
    app.get("/response", () => new Response("r", { status: 203, headers: { "x-r": "1" } }));
    app.get("/redirect", (_, c) => c.redirect("/x"));
    app.get("/async", async () => "async");
    app.get("/boom", () => {
        throw new Error("boom");
    });
    app.get("/http-error", () => {
        throw new HttpError(403, "no");
    });
    app.get("/not-found", (_, c) => c.notFound());
    app.post("/only-post", () => "post");
}

const SYNC = ["/", "/json", "/users/42", "/status", "/cookies", "/type", "/c-text", "/response", "/redirect"];
const ASYNC: [string, RequestInit?][] = [
    ["/async"],
    ["/boom"],
    ["/http-error"],
    ["/not-found"],
    ["/missing"],
    ["/only-post"],
    ["/", { method: "HEAD" }],
    ["/json", { method: "HEAD" }],
];

describe("同期で返すとき", () => {
    const app = createApp<any>();
    addRoutes(app);
    // 同じアプリに何もしないミドルウェアを挟むと、いつも Promise の道を通る(今までの道)
    const viaPromise = createApp<any>();
    viaPromise.use((_c, next) => next());
    addRoutes(viaPromise);

    for (const path of SYNC) {
        test(`${path}: Response をそのまま返し、中身は Promise の道と同じ`, async () => {
            const res = app.fetch(req(path));
            expect(res).toBeInstanceOf(Response);
            const other = viaPromise.fetch(req(path));
            expect(other).toBeInstanceOf(Promise);
            expect(await snapshot(res as Response)).toEqual(await snapshot(await other));
        });
    }

    test("c.header() で付けたものと Cookie とステータスが付く", async () => {
        const status = app.fetch(req("/status")) as Response;
        expect(status.status).toBe(201);
        expect(status.headers.get("x-mark")).toBe("1");
        const cookies = app.fetch(req("/cookies")) as Response;
        expect(cookies.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly; SameSite=Lax", "b=2; Path=/; HttpOnly; SameSite=Lax"]);
    });

    test("当たらないパス付きのミドルウェアは、同期で返すのを止めない", async () => {
        const scoped = createApp();
        scoped.use("/admin/*", (_c, next) => next());
        scoped.get("/", () => "hi");
        scoped.get("/admin/x", () => "admin");
        expect(scoped.fetch(req("/"))).toBeInstanceOf(Response);
        const admin = scoped.fetch(req("/admin/x"));
        expect(admin).toBeInstanceOf(Promise);
        expect(await (await admin).text()).toBe("admin");
    });
});

describe("Promise を返すとき", () => {
    const app = createApp<any>();
    addRoutes(app);
    const viaPromise = createApp<any>();
    viaPromise.use((_c, next) => next());
    addRoutes(viaPromise);

    for (const [path, init] of ASYNC) {
        test(`${init?.method ?? "GET"} ${path}: Promise を返し、中身はミドルウェアありと同じ`, async () => {
            const res = app.fetch(req(path, init));
            expect(res).toBeInstanceOf(Promise);
            expect(await snapshot(await res)).toEqual(await snapshot(await viaPromise.fetch(req(path, init))));
        });
    }

    test("HEAD は本文を返さない", async () => {
        const res = await app.fetch(req("/", { method: "HEAD" }));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("");
    });

    test("ミドルウェア(全体・パス付き)があれば Promise", async () => {
        const global = createApp();
        global.use(async (c, next) => {
            const res = await next();
            c.header("x-after", "1");
            return res;
        });
        global.get("/", () => "hi");
        const res = global.fetch(req("/"));
        expect(res).toBeInstanceOf(Promise);
        expect((await res).headers.get("x-after")).toBe("1");

        const scoped = createApp();
        scoped.use("/", (_c, next) => next());
        scoped.get("/", () => "hi");
        expect(scoped.fetch(req("/"))).toBeInstanceOf(Promise);
    });

    test("async の notFound と onError", async () => {
        const custom = createApp();
        custom.notFound(async (c) => c.text("nope", 404));
        custom.onError(async (err, c) => c.text(`err: ${(err as Error).message}`, 500));
        custom.get("/boom", () => {
            throw new Error("x");
        });
        const missing = custom.fetch(req("/missing"));
        expect(missing).toBeInstanceOf(Promise);
        expect(await (await missing).text()).toBe("nope");
        const boom = custom.fetch(req("/boom"));
        expect(boom).toBeInstanceOf(Promise);
        const res = await boom;
        expect(res.status).toBe(500);
        expect(await res.text()).toBe("err: x");
    });

    test("開発モードは、いつも Promise", async () => {
        const dev = createApp({ dev: devtools({ lang: "ja" }) });
        dev.get("/", () => "hi");
        const res = dev.fetch(req("/"));
        expect(res).toBeInstanceOf(Promise);
        expect(await (await res).text()).toBe("hi");
    });
});
