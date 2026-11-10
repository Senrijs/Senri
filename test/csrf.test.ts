import { describe, expect, test } from "bun:test";
import { createApp, csrf, type CsrfOptions } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";

function makeApp(options?: CsrfOptions) {
    const app = createApp();
    app.use(csrf(options));
    for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "QUERY"] as const) {
        app.on(method, "/form", () => "ok");
    }
    return app;
}

// Host は app.fetch の URL から決まる(http://example.com/form なら example.com)
async function send(app: ReturnType<typeof makeApp>, method: string, headers: Record<string, string> = {}, url = "http://example.com/form") {
    const init: RequestInit = { method, headers };
    if (method === "QUERY") {
        init.body = "{}";
        (init.headers as Record<string, string>)["content-type"] = "application/json";
    }
    return (await app.fetch(new Request(url, init))).status;
}

describe("csrf()", () => {
    test("GET・HEAD・OPTIONS は、よそのサイトからでも確かめない", async () => {
        const app = makeApp();
        for (const method of ["GET", "HEAD", "OPTIONS"]) {
            expect(await send(app, method, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).toBe(200);
        }
    });

    test("Sec-Fetch-Site が same-origin か none なら通す", async () => {
        const app = makeApp();
        expect(await send(app, "POST", { "sec-fetch-site": "same-origin", origin: "http://example.com" })).toBe(200);
        // アドレスバーやブックマークから(Origin はないこともある)
        expect(await send(app, "POST", { "sec-fetch-site": "none" })).toBe(200);
    });

    test("Sec-Fetch-Site が cross-site・same-site なら 403(状態を変えるメソッドすべて)", async () => {
        const app = makeApp();
        for (const method of ["POST", "PUT", "PATCH", "DELETE", "QUERY"]) {
            expect(await send(app, method, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).toBe(403);
        }
        // 同じサイトの別のオリジン(サブドメイン)も、よそのオリジン
        expect(await send(app, "POST", { "sec-fetch-site": "same-site", origin: "http://sub.example.com" })).toBe(403);
    });

    test("Sec-Fetch-Site があれば、Origin がホストと同じでもそちらを信じる", async () => {
        const app = makeApp();
        expect(await send(app, "POST", { "sec-fetch-site": "cross-site", origin: "http://example.com" })).toBe(403);
    });

    test("Sec-Fetch-Site がない古いブラウザ: Origin のホストが Host と同じなら通す(スキームは比べない)", async () => {
        const app = makeApp();
        expect(await send(app, "POST", { origin: "http://example.com" })).toBe(200);
        // TLS を終えるプロキシの後ろでは、アプリから見たリクエストは http
        expect(await send(app, "POST", { origin: "https://example.com" })).toBe(200);
        expect(await send(app, "POST", { origin: "http://example.com:8080" }, "http://example.com:8080/form")).toBe(200);
    });

    test("Sec-Fetch-Site がない古いブラウザ: Origin のホストが違えば 403", async () => {
        const app = makeApp();
        for (const origin of ["https://evil.example", "http://example.com:8080", "http://sub.example.com", "null", "not a url"]) {
            expect(await send(app, "POST", { origin })).toBe(403);
        }
    });

    test("Sec-Fetch-Site も Origin もなければ、ブラウザ以外からとして通す", async () => {
        const app = makeApp();
        expect(await send(app, "POST")).toBe(200);
    });

    test("origin に入れたオリジンは、よそからでも通す(大文字小文字は区別しない)", async () => {
        const app = makeApp({ origin: ["https://admin.example.com"] });
        expect(await send(app, "POST", { "sec-fetch-site": "cross-site", origin: "https://admin.example.com" })).toBe(200);
        expect(await send(app, "POST", { origin: "https://ADMIN.example.com" })).toBe(200);
        // スキームやポートが違えば別のオリジン
        expect(await send(app, "POST", { "sec-fetch-site": "cross-site", origin: "http://admin.example.com" })).toBe(403);
        expect(await send(app, "POST", { "sec-fetch-site": "cross-site", origin: "https://admin.example.com:8443" })).toBe(403);
        // Origin がなければ、origin の指定では通さない
        expect(await send(app, "POST", { "sec-fetch-site": "cross-site" })).toBe(403);
    });

    test("JSDoc の例: 1 つの csrf() に origin を渡すと、同じオリジンと admin.example.com の両方を通す", async () => {
        const app = createApp();
        app.use(csrf({ origin: ["https://admin.example.com"] }));
        app.post("/api/items", () => "created");
        app.post("/form", () => "posted");
        const post = (path: string, headers: Record<string, string>) =>
            app.fetch(new Request(`http://example.com${path}`, { method: "POST", headers })).then((res) => res.status);
        for (const path of ["/api/items", "/form"]) {
            expect(await post(path, { "sec-fetch-site": "same-origin", origin: "http://example.com" })).toBe(200);
            expect(await post(path, { "sec-fetch-site": "cross-site", origin: "https://admin.example.com" })).toBe(200);
            expect(await post(path, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).toBe(403);
        }
    });

    test("csrf() を重ねても、後ろの origin は効かない(先の csrf() が止める)", async () => {
        const app = createApp();
        app.use(csrf());
        app.use("/api", csrf({ origin: ["https://admin.example.com"] }));
        app.post("/api/items", () => "created");
        const res = await app.fetch(
            new Request("http://example.com/api/items", {
                method: "POST",
                headers: { "sec-fetch-site": "cross-site", origin: "https://admin.example.com" },
            }),
        );
        expect(res.status).toBe(403);
    });

    test("origin は関数でも決められる(true のときだけ通す)", async () => {
        const app = makeApp({ origin: (origin) => origin.endsWith(".trusted.example") });
        expect(await send(app, "POST", { "sec-fetch-site": "cross-site", origin: "https://a.trusted.example" })).toBe(200);
        expect(await send(app, "POST", { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).toBe(403);
    });

    test("origin の形がおかしければ TypeError", () => {
        for (const origin of ["https://example.com/", "https://example.com/path", "example.com", "", ["https://ok.example", "*"]]) {
            let thrown: unknown;
            try {
                csrf({ origin: origin as string });
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeInstanceOf(TypeError);
            expect((thrown as { code?: string }).code).toBe("csrf_origin");
            expect(explainText(thrown, "ja")).toContain("https://example.com");
        }
    });

    test("拒否は HttpError なので、app.onError で本文を変えられる", async () => {
        const app = makeApp();
        app.onError((err, c) => c.json({ error: "cross-origin" }));
        const res = await app.fetch(new Request("http://example.com/form", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }));
        expect([res.status, await res.json()]).toEqual([403, { error: "cross-origin" }]);
    });

    test("開発モードでは、拒否した理由を出す", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.use(csrf());
        app.post("/form", () => "ok");
        const res = await app.fetch(
            new Request("http://localhost/form", { method: "POST", headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } }),
        );
        expect(res.status).toBe(403);
        expect(await res.text()).toContain("csrf({ origin: [...] })");
    });

    test("Node の近道で使える(markPlainSafe)", () => {
        expect(isPlainSafe(csrf())).toBe(true);
    });
});
