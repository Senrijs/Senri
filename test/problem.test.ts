import { describe, expect, test } from "bun:test";
import { basicAuth, createApp, HttpError, type StandardSchemaV1 } from "../src/index.ts";
import { problem, problemDetails, ProblemError, type ProblemDetailsOptions } from "../src/problem.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

function makeApp(options?: ProblemDetailsOptions) {
    const app = createApp();
    const problems = problemDetails(options);
    app.onError(problems.onError);
    app.notFound(problems.notFound);
    return app;
}

async function read(res: Response) {
    return { status: res.status, type: res.headers.get("content-type"), body: await res.json() };
}

// クエリの page が正の整数か(Standard Schema を手で書いたもの)
const pageSchema: StandardSchemaV1<unknown, { page: number }> = {
    "~standard": {
        version: 1,
        vendor: "test",
        validate(value) {
            const page = Number((value as { page?: unknown }).page);
            return Number.isInteger(page) && page > 0
                ? { value: { page } }
                : { issues: [{ message: "Expected a positive integer", path: [{ key: "page" }] }] };
        },
    },
};

describe("problemDetails()", () => {
    test("ProblemError は、そのメンバーで application/problem+json を返す", async () => {
        const app = makeApp();
        app.post("/transfer", () => {
            throw new ProblemError(
                403,
                {
                    type: "https://example.com/probs/out-of-credit",
                    title: "You do not have enough credit.",
                    detail: "Your current balance is 30, but that costs 50.",
                    instance: "/account/12345/msgs/abc",
                    extensions: { balance: 30, accounts: ["/account/12345"] },
                },
                { headers: { "x-reason": "credit" } },
            );
        });
        const res = await app.fetch(req("/transfer", { method: "POST" }));
        expect(res.headers.get("x-reason")).toBe("credit");
        expect(await read(res)).toEqual({
            status: 403,
            type: "application/problem+json",
            body: {
                type: "https://example.com/probs/out-of-credit",
                title: "You do not have enough credit.",
                status: 403,
                detail: "Your current balance is 30, but that costs 50.",
                instance: "/account/12345/msgs/abc",
                balance: 30,
                accounts: ["/account/12345"],
            },
        });
    });

    test("extensions で決まったメンバー(type・status など)は上書きできない", async () => {
        const app = makeApp();
        app.get("/", () => {
            throw new ProblemError(409, { extensions: { status: 200, type: "x", title: "y", detail: "z", instance: "w", ok: true } });
        });
        expect((await read(await app.fetch(req("/")))).body).toEqual({ type: "about:blank", title: "Conflict", status: 409, ok: true });
    });

    test("type を省くと about:blank で、title は status の名前", async () => {
        const app = makeApp();
        app.get("/", () => {
            throw new ProblemError(422, { detail: "The name is taken." });
        });
        expect(await read(await app.fetch(req("/")))).toEqual({
            status: 422,
            type: "application/problem+json",
            body: { type: "about:blank", title: "Unprocessable Content", status: 422, detail: "The name is taken." },
        });
    });

    test("ほかの HttpError: status の名前を title に、status だけの message は detail にしない", async () => {
        const app = makeApp();
        app.get("/plain", () => {
            throw new HttpError(404, "404 Not Found");
        });
        app.get("/default", () => {
            throw new HttpError(503);
        });
        app.get("/custom", () => {
            throw new HttpError(400, "The date is in the past.");
        });
        app.post("/json", async (_, c) => c.body());
        expect((await read(await app.fetch(req("/plain")))).body).toEqual({ type: "about:blank", title: "Not Found", status: 404 });
        expect((await read(await app.fetch(req("/default")))).body).toEqual({ type: "about:blank", title: "Service Unavailable", status: 503 });
        expect((await read(await app.fetch(req("/custom")))).body).toEqual({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            detail: "The date is in the past.",
        });
        // Senri の "400 Bad Request: Invalid JSON" は、": " の後ろを detail にする
        const res = await app.fetch(req("/json", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
        expect((await read(res)).body).toEqual({ type: "about:blank", title: "Bad Request", status: 400, detail: "Invalid JSON" });
    });

    test("405 は Allow ヘッダーを残す", async () => {
        const app = makeApp();
        app.get("/items", () => "items");
        const res = await app.fetch(req("/items", { method: "DELETE" }));
        expect(res.headers.get("allow")).toContain("GET");
        expect(await read(res)).toEqual({
            status: 405,
            type: "application/problem+json",
            body: { type: "about:blank", title: "Method Not Allowed", status: 405 },
        });
    });

    test("ミドルウェアの HttpError のヘッダー(WWW-Authenticate)も残る", async () => {
        const app = makeApp();
        app.use(basicAuth({ username: "a", password: "b" }));
        app.get("/", () => "secret");
        const res = await app.fetch(req("/"));
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toStartWith("Basic");
        expect(res.headers.get("content-type")).toBe("application/problem+json");
    });

    test("HttpError でないエラーは 500 で、message を出さない", async () => {
        const app = makeApp();
        app.get("/", () => {
            throw new Error("password=hunter2");
        });
        const res = await app.fetch(req("/"));
        const text = await res.clone().text();
        expect(text).not.toContain("hunter2");
        expect(await read(res)).toEqual({
            status: 500,
            type: "application/problem+json",
            body: { type: "about:blank", title: "Internal Server Error", status: 500 },
        });
    });

    test("ルートがないときと c.notFound() は 404", async () => {
        const app = makeApp();
        app.get("/items/:id", (_, c) => c.notFound());
        for (const path of ["/nope", "/items/1"]) {
            expect(await read(await app.fetch(req(path)))).toEqual({
                status: 404,
                type: "application/problem+json",
                body: { type: "about:blank", title: "Not Found", status: 404 },
            });
        }
    });

    test("HEAD でも status と Content-Type は同じ(本文は、既定の 404 と同じくサーバーが落とす)", async () => {
        const app = makeApp();
        const res = await app.fetch(req("/nope", { method: "HEAD" }));
        expect(res.status).toBe(404);
        expect(res.headers.get("content-type")).toBe("application/problem+json");
    });

    test("バリデーションのエラー: 既定では issues を出さない", async () => {
        const app = makeApp();
        app.get("/list", { query: pageSchema }, () => "ok");
        expect((await read(await app.fetch(req("/list?page=x")))).body).toEqual({ type: "about:blank", title: "Bad Request", status: 400 });
    });

    test("バリデーションのエラー: validationErrors なら errors に出す", async () => {
        const app = makeApp({ validationErrors: true });
        app.get("/list", { query: pageSchema }, () => "ok");
        expect((await read(await app.fetch(req("/list?page=x")))).body).toEqual({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            errors: [{ in: "query", path: ["page"], message: "Expected a positive integer" }],
        });
    });
});

describe("problem()", () => {
    test("ハンドラーから返せる。c.header() のヘッダーも付く", async () => {
        const app = createApp();
        app.get("/legacy", (_, c) => {
            c.header("x-docs", "/v2");
            return problem(c, { status: 410, detail: "Use /v2 instead." });
        });
        const res = await app.fetch(req("/legacy"));
        expect(res.headers.get("x-docs")).toBe("/v2");
        expect(await read(res)).toEqual({
            status: 410,
            type: "application/problem+json",
            body: { type: "about:blank", title: "Gone", status: 410, detail: "Use /v2 instead." },
        });
    });

    test("status を省くと c.status() のもの", async () => {
        const app = createApp();
        app.get("/", (_, c) => problem(c.status(429)));
        expect((await read(await app.fetch(req("/")))).body).toEqual({ type: "about:blank", title: "Too Many Requests", status: 429 });
    });

    test("about:blank でない type なら、title は省ける(勝手に付けない)", async () => {
        const app = createApp();
        app.get("/", (_, c) => problem(c, { type: "https://example.com/probs/x", status: 400 }));
        expect((await read(await app.fetch(req("/")))).body).toEqual({ type: "https://example.com/probs/x", status: 400 });
    });

    test("知らない status の title は HTTP <status>", async () => {
        const app = createApp();
        app.get("/", (_, c) => problem(c, { status: 599 }));
        expect((await read(await app.fetch(req("/")))).body).toEqual({ type: "about:blank", title: "HTTP 599", status: 599 });
    });
});

describe("使わないときは今までどおり", () => {
    test("既定の onError では、ProblemError は detail(なければ title)を文字列で返す HttpError", async () => {
        const app = createApp();
        app.get("/a", () => {
            throw new ProblemError(409, { title: "Conflict!", detail: "Already shipped." });
        });
        app.get("/b", () => {
            throw new ProblemError(409, { title: "Conflict!" });
        });
        app.get("/c", () => {
            throw new ProblemError(409);
        });
        for (const [path, text] of [
            ["/a", "Already shipped."],
            ["/b", "Conflict!"],
            ["/c", "Conflict"],
        ] as const) {
            const res = await app.fetch(req(path));
            expect([res.status, res.headers.get("content-type"), await res.text()]).toEqual([409, "text/plain; charset=utf-8", text]);
        }
        expect(new ProblemError(400)).toBeInstanceOf(HttpError);
    });
});
