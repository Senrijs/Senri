import { describe, expect, spyOn, test } from "bun:test";
import { type } from "arktype";
import * as v from "valibot";
import { z } from "zod";
import { createApp, defineRoutes, endpoint, type Middleware } from "../src/index.ts";
import { openAPI } from "../src/openapi.ts";
import { devtools } from "../src/dev/index.ts";

const user = z.object({ id: z.string(), name: z.string(), at: z.string() });
const info = { title: "Test", version: "1.0.0" };
const auth: Middleware = async (_c, next) => {
    await next();
};

const routes = defineRoutes({
    "GET /users/:id": endpoint(
        { params: z.object({ id: z.coerce.number() }), response: user, responses: { 404: z.object({ message: z.string() }) }, openapi: { summary: "Get a user", tags: ["users"], operationId: "getUser" } },
        ({ id }) => ({ id: String(id), name: "a", at: "x" }),
    ),
    "GET /users": endpoint({ query: z.object({ q: z.string(), limit: z.coerce.number().optional() }) }, () => []),
    "POST /users": endpoint({ body: z.object({ name: z.string() }), use: [auth] }, () => "ok"),
    "POST /upload": endpoint({ body: type({ title: "string" }), bodyType: "form" }, () => "ok"),
    "GET /files/*": () => "file",
    "GET /text": endpoint({ response: z.string() }, () => "hi"),
    "GET /plain": () => "x",
});

describe("openAPI()", () => {
    const doc = openAPI(routes, { info, onWarning: () => {} }) as any;

    test("OpenAPI 3.1 の文書で、パスとメソッドは表のキーから", () => {
        expect(doc.openapi).toBe("3.1.0");
        expect(doc.info).toEqual(info);
        expect(Object.keys(doc.paths)).toEqual(["/users/{id}", "/users", "/upload", "/files/{path}", "/text", "/plain"]);
        expect(Object.keys(doc.paths["/users"])).toEqual(["get", "post"]);
    });

    test("パスパラメーター: params のスキーマの入力の型。なければ文字列", () => {
        expect(doc.paths["/users/{id}"].get.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "number" } }]);
        expect(doc.paths["/files/{path}"].get.parameters[0]).toMatchObject({ name: "path", in: "path", required: true, schema: { type: "string" } });
    });

    test("クエリ: オブジェクトのスキーマのプロパティを 1 つずつ。required もスキーマから", () => {
        expect(doc.paths["/users"].get.parameters).toEqual([
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "number" } },
        ]);
    });

    test("ボディ: 既定は JSON。bodyType: \"form\" ならフォーム。ArkType のスキーマも変換できる", () => {
        expect(doc.paths["/users"].post.requestBody).toMatchObject({
            required: true,
            content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
        });
        const form = doc.paths["/upload"].post.requestBody.content;
        expect(Object.keys(form)).toEqual(["application/x-www-form-urlencoded", "multipart/form-data"]);
        expect(form["multipart/form-data"].schema).toMatchObject({ type: "object", properties: { title: { type: "string" } } });
    });

    test("レスポンス: response と responses から。書いていなければスキーマのない 200", () => {
        const get = doc.paths["/users/{id}"].get;
        expect(get.responses["200"].content["application/json"].schema).toMatchObject({ type: "object", required: ["id", "name", "at"] });
        expect(get.responses["404"]).toMatchObject({ description: "Not Found", content: { "application/json": { schema: { type: "object" } } } });
        expect(doc.paths["/plain"].get.responses).toEqual({ "200": { description: "OK" } });
        // 文字列のスキーマは text/plain
        expect(Object.keys(doc.paths["/text"].get.responses["200"].content)).toEqual(["text/plain"]);
    });

    test("endpoint({ openapi }) の項目は、そのまま入る。$schema は入れない", () => {
        expect(doc.paths["/users/{id}"].get).toMatchObject({ summary: "Get a user", tags: ["users"], operationId: "getUser" });
        expect(JSON.stringify(doc)).not.toContain("$schema");
    });

    test("version: \"3.0\" なら OpenAPI 3.0 の形", () => {
        const v30 = openAPI(routes, { info, version: "3.0", onWarning: () => {} }) as any;
        expect(v30.openapi).toBe("3.0.3");
        expect(v30.paths["/users/{id}"].get.responses["200"].content["application/json"].schema.type).toBe("object");
    });

    test("security・servers・components・tags を入れられる。ルートの security が優先", () => {
        const secured = openAPI(
            defineRoutes({
                "GET /a": () => "a",
                "GET /b": endpoint({ openapi: { security: [] } }, () => "b"),
            }),
            {
                info,
                security: [{ bearerAuth: [] }],
                servers: [{ url: "https://example.com" }],
                components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
                tags: [{ name: "users" }],
            },
        ) as any;
        expect(secured.paths["/a"].get.security).toEqual([{ bearerAuth: [] }]);
        expect(secured.paths["/b"].get.security).toEqual([]);
        expect(secured.servers).toEqual([{ url: "https://example.com" }]);
        expect(secured.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
        expect(secured.tags).toEqual([{ name: "users" }]);
    });

    test("JSON Schema にできないスキーマは {} にして警告する。toJSONSchema を渡せば使う", () => {
        const table = defineRoutes({ "POST /v": endpoint({ body: v.object({ name: v.string() }) }, () => "ok") });
        const warnings: string[] = [];
        const plain = openAPI(table, { info, onWarning: (m) => warnings.push(m) }) as any;
        expect(plain.paths["/v"].post.requestBody.content["application/json"].schema).toEqual({});
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain("POST /v body");

        const converted = openAPI(table, { info, toJSONSchema: (_s, { io }) => ({ type: "object", description: io }) }) as any;
        expect(converted.paths["/v"].post.requestBody.content["application/json"].schema).toEqual({ type: "object", description: "input" });
    });

    test("OpenAPI にないメソッドは入れずに警告する。警告の既定は console.warn", () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            const doc2 = openAPI(defineRoutes({ "QUERY /search": () => "x" }), { info }) as any;
            expect(doc2.paths).toEqual({});
            expect(String(warn.mock.calls[0]?.[0])).toContain("QUERY");
        } finally {
            warn.mockRestore();
        }
    });
});

describe("endpoint({ response }) と開発モード", () => {
    test("response などの OpenAPI 用の項目があっても、ルートは動く(本番)", async () => {
        const app = createApp();
        app.routes(routes);
        expect(await (await app.fetch(new Request("http://localhost/users/1"))).json()).toEqual({ id: "1", name: "a", at: "x" });
    });

    test("開発モードでは、戻り値が response のスキーマに合わなければ警告する(応答は変えない。同じずれは 1 回だけ)", async () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            const app = createApp({ dev: devtools({ lang: "en" }) });
            app.routes(
                defineRoutes({
                    "GET /bad": endpoint({ response: z.object({ name: z.string() }) }, () => ({ name: 1 })),
                    "GET /good": endpoint({ response: z.object({ at: z.string() }) }, () => ({ at: new Date(0) })),
                }),
            );
            const req = (path: string) => new Request(`http://localhost:3927${path}`, { headers: { host: "localhost:3927" } });
            const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
            expect(await (await app.fetch(req("/bad"), local)).json()).toEqual({ name: 1 });
            await app.fetch(req("/bad"), local);
            // Date は JSON にしたあとの形(文字列)で確かめるので、合っている
            await app.fetch(req("/good"), local);
            const mismatches = warn.mock.calls.map((args) => String(args[0])).filter((m) => m.includes("response schema"));
            expect(mismatches.length).toBe(1);
            expect(mismatches[0]).toContain("GET /bad");
            expect(mismatches[0]).toContain("name");
        } finally {
            warn.mockRestore();
        }
    });
});
