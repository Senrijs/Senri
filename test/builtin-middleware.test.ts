import { describe, expect, test } from "bun:test";
import { bodyLimit, cors, createApp, secureHeaders } from "../src/index.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("cors()", () => {
    test("既定ではどのオリジンにも * を返す", async () => {
        const app = createApp();
        app.use(cors());
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x", { headers: { origin: "https://a.example" } }));
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(res.headers.get("vary")).toBeNull();
    });

    test("Origin のないリクエストには付けない", async () => {
        const app = createApp();
        app.use(cors());
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x"));
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    test("プリフライトには 204 と許可の一覧を返し、ハンドラーは呼ばない", async () => {
        const app = createApp();
        app.use(cors({ maxAge: 600 }));
        let called = false;
        app.on(["PUT", "OPTIONS"], "/x", () => {
            called = true;
            return "x";
        });

        const res = await app.fetch(
            req("/x", {
                method: "OPTIONS",
                headers: {
                    origin: "https://a.example",
                    "access-control-request-method": "PUT",
                    "access-control-request-headers": "x-token, content-type",
                },
            }),
        );
        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
        expect(res.headers.get("access-control-allow-methods")).toContain("QUERY");
        // allowHeaders を指定しなければ、頼まれたヘッダーをそのまま許可する
        expect(res.headers.get("access-control-allow-headers")).toBe("x-token, content-type");
        expect(res.headers.get("access-control-max-age")).toBe("600");
        expect(res.headers.get("vary")).toContain("Access-Control-Request-Headers");
        expect(called).toBe(false);
    });

    test("ルートがなくてもプリフライトに答える", async () => {
        const app = createApp();
        app.use(cors());

        const res = await app.fetch(
            req("/nothing", { method: "OPTIONS", headers: { origin: "https://a.example", "access-control-request-method": "POST" } }),
        );
        expect(res.status).toBe(204);
    });

    test("オリジンを一覧で絞ると、合うものだけ返して Vary: Origin を付ける", async () => {
        const app = createApp();
        app.use(cors({ origin: ["https://a.example", "https://b.example"] }));
        app.get("/x", () => "x");

        const ok = await app.fetch(req("/x", { headers: { origin: "https://b.example" } }));
        expect(ok.headers.get("access-control-allow-origin")).toBe("https://b.example");
        expect(ok.headers.get("vary")).toBe("Origin");

        const ng = await app.fetch(req("/x", { headers: { origin: "https://evil.example" } }));
        expect(ng.headers.get("access-control-allow-origin")).toBeNull();
        expect(ng.headers.get("vary")).toBe("Origin");
    });

    test("オリジンを関数で決められる", async () => {
        const app = createApp();
        app.use(cors({ origin: (origin) => origin.endsWith(".example") }));
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x", { headers: { origin: "https://z.example" } }));
        expect(res.headers.get("access-control-allow-origin")).toBe("https://z.example");
    });

    test("credentials と exposeHeaders", async () => {
        const app = createApp();
        app.use(cors({ origin: "https://a.example", credentials: true, exposeHeaders: ["x-total"] }));
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x", { headers: { origin: "https://a.example" } }));
        expect(res.headers.get("access-control-allow-credentials")).toBe("true");
        expect(res.headers.get("access-control-expose-headers")).toBe("x-total");
    });

    test("credentials と origin: * の組み合わせはエラー(ブラウザが受け付けないため)", () => {
        expect(() => cors({ credentials: true })).toThrow("credentials");
    });

    test("エラーのレスポンスにも付く", async () => {
        const app = createApp();
        app.use(cors());
        app.get("/boom", () => {
            throw new Error("x");
        });

        const res = await app.fetch(req("/boom", { headers: { origin: "https://a.example" } }));
        expect(res.status).toBe(500);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    test("ハンドラーが付けた Vary を消さない", async () => {
        const app = createApp();
        app.use(cors({ origin: ["https://a.example"] }));
        app.get("/x", () => new Response("x", { headers: { vary: "Accept-Encoding" } }));

        const res = await app.fetch(req("/x", { headers: { origin: "https://a.example" } }));
        expect(res.headers.get("vary")).toBe("Accept-Encoding, Origin");
    });
});

describe("secureHeaders()", () => {
    test("既定のヘッダーが付く", async () => {
        const app = createApp();
        app.use(secureHeaders());
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x"));
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
        expect(res.headers.get("strict-transport-security")).toBe("max-age=15552000; includeSubDomains");
        expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
        expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(res.headers.get("x-xss-protection")).toBe("0");
        // CSP は既定では付けない(アプリごとに中身が違うため)
        expect(res.headers.get("content-security-policy")).toBeNull();
    });

    test("個別に変えたり、false で外したりできる", async () => {
        const app = createApp();
        app.use(
            secureHeaders({
                xFrameOptions: "DENY",
                strictTransportSecurity: false,
                contentSecurityPolicy: "default-src 'self'",
            }),
        );
        app.get("/x", () => "x");

        const res = await app.fetch(req("/x"));
        expect(res.headers.get("x-frame-options")).toBe("DENY");
        expect(res.headers.get("strict-transport-security")).toBeNull();
        expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
    });

    test("ハンドラーが自分で付けたものは上書きしない", async () => {
        const app = createApp();
        app.use(secureHeaders());
        app.get("/embed", () => new Response("x", { headers: { "x-frame-options": "ALLOWALL" } }));
        app.get("/embed2", (_, c) => {
            c.header("x-frame-options", "ALLOWALL");
            return "x";
        });

        expect((await app.fetch(req("/embed"))).headers.get("x-frame-options")).toBe("ALLOWALL");
        expect((await app.fetch(req("/embed2"))).headers.get("x-frame-options")).toBe("ALLOWALL");
    });

    test("変更できないヘッダーの Response(Response.redirect)でも付く", async () => {
        const app = createApp();
        app.use(secureHeaders());
        app.get("/go", () => Response.redirect("http://localhost/x", 302));

        const res = await app.fetch(req("/go"));
        expect(res.status).toBe(302);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    test("エラーのレスポンスにも付く", async () => {
        const app = createApp();
        app.use(secureHeaders());

        const res = await app.fetch(req("/nothing"));
        expect(res.status).toBe(404);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
});

describe("bodyLimit()", () => {
    const echo = () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 10 }));
        app.post("/echo", async (_, c) => `got ${(await c.req.text()).length}`);
        app.post("/json", async (_, c) => c.body());
        return app;
    };

    test("上限以下なら通る", async () => {
        const res = await echo().fetch(req("/echo", { method: "POST", body: "0123456789" }));
        expect(await res.text()).toBe("got 10");
    });

    test("Content-Length が上限を超えていれば、読まずに 413", async () => {
        const res = await echo().fetch(
            req("/echo", { method: "POST", headers: { "content-length": "11" }, body: "01234567890" }),
        );
        expect(res.status).toBe(413);
        expect(await res.text()).toBe("413 Content Too Large");
    });

    test("Content-Length がない(チャンク転送)ときも、読んだ量で 413", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("012345"));
                controller.enqueue(new TextEncoder().encode("6789ab"));
                controller.close();
            },
        });
        const res = await echo().fetch(req("/echo", { method: "POST", body: stream, duplex: "half" } as RequestInit));
        expect(res.status).toBe(413);
    });

    test("c.body() で読んでも 413", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`{"a":"0123456789"}`));
                controller.close();
            },
        });
        const res = await echo().fetch(
            req("/json", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: stream,
                duplex: "half",
            } as RequestInit),
        );
        expect(res.status).toBe(413);
    });

    test("ボディのないリクエストはそのまま", async () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 0 }));
        app.get("/x", () => "x");

        expect((await app.fetch(req("/x"))).status).toBe(200);
    });

    test("413 のときのレスポンスを変えられる", async () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 1, onError: (c) => c.json({ error: "too large" }, 413) }));
        app.post("/x", () => "x");

        const res = await app.fetch(req("/x", { method: "POST", headers: { "content-length": "5" }, body: "12345" }));
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({ error: "too large" });
    });

    test("maxSize が数でなければエラー", () => {
        expect(() => bodyLimit({ maxSize: Number.NaN })).toThrow("maxSize");
        expect(() => bodyLimit({ maxSize: -1 })).toThrow("maxSize");
    });
});

describe("レビューで見つかったもの", () => {
    test("cors: 許可するオリジンがリクエストで変わるなら、Origin のないレスポンスにも Vary: Origin", async () => {
        for (const origin of [["https://a.example"], () => true]) {
            const app = createApp();
            app.use(cors({ origin }));
            app.get("/", () => "ok");
            const res = await app.fetch(new Request("http://localhost/"));
            expect(res.headers.get("vary")).toBe("Origin");
            expect(res.headers.get("access-control-allow-origin")).toBeNull();
        }
        // "*" ならオリジンで変わらないので付けない
        const app = createApp();
        app.use(cors());
        app.get("/", () => "ok");
        expect((await app.fetch(new Request("http://localhost/"))).headers.get("vary")).toBeNull();
    });

    test("bodyLimit: 数字でない Content-Length は 400", async () => {
        const app = createApp();
        app.use(bodyLimit({ maxSize: 10 }));
        app.post("/", async (_, c) => c.req.text());
        const res = await app.fetch(
            new Request("http://localhost/", { method: "POST", body: "x".repeat(100), headers: { "content-length": "abc" } }),
        );
        expect(res.status).toBe(400);
    });
});
