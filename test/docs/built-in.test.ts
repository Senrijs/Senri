// ドキュメントの「ミドルウェアの一覧」の章に書いた動き
import { expect } from "bun:test";
import { basicAuth, bearerAuth, bodyLimit, cache, compress, cors, createApp, csrf, etag, health, HttpError, ipRestriction, languageDetector, logger, methodOverride, prettyJSON, rateLimit, requestId, safeFileName, secureHeaders, timeout, trailingSlash, uploadLimit } from "../../src/index.ts";
import { jwt, signJwt } from "../../src/jwt.ts";
import { trustProxy } from "../../src/ip.ts";
import { setDraining } from "../../src/health.ts";
import { claim, ipInfo, local, quiet, req } from "./claim.ts";

// ---------- built-in/cors ----------
claim("built-in/cors#preflight", "プリフライトには 204 を返す", async () => {
    const app = createApp();
    app.use(cors({ origin: ["https://example.com"] }));
    app.get("/x", () => "x");
    const r = await req(app, "OPTIONS", "/x", { headers: { origin: "https://example.com", "access-control-request-method": "GET" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://example.com");
});
claim("built-in/cors#not-allowed", "許していないオリジンには何も足さない。\"*\" でなければ Vary: Origin", async () => {
    const app = createApp();
    app.use(cors({ origin: ["https://example.com"] }));
    app.get("/x", () => "x");
    expect((await req(app, "GET", "/x", { headers: { origin: "https://evil.example" } })).headers.get("access-control-allow-origin")).toBeNull();
    expect((await req(app, "GET", "/x", { headers: { origin: "https://example.com" } })).headers.get("vary")).toContain("Origin");
});
claim("built-in/cors#credentials-star", 'credentials: true と origin: "*" は一緒に使えない', () => {
    expect(() => cors({ credentials: true })).toThrow();
});
claim("built-in/cors#function", "関数で true を返すと、そのオリジンを許す", async () => {
    const app = createApp();
    app.use(cors({ origin: (origin) => origin.endsWith(".example.com") }));
    app.get("/x", () => "x");
    expect((await req(app, "GET", "/x", { headers: { origin: "https://a.example.com" } })).headers.get("access-control-allow-origin")).toBe("https://a.example.com");
});

// ---------- built-in/csrf ----------
{
    const app = createApp();
    app.use(csrf());
    app.post("/x", () => "ok");
    app.get("/x", () => "ok");
    claim("built-in/csrf#sec-fetch-site", "Sec-Fetch-Site がよそのオリジンなら 403", async () => {
        expect((await req(app, "POST", "/x", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    });
    claim("built-in/csrf#origin", "Sec-Fetch-Site がなければ、Origin のホストを Host と比べる", async () => {
        expect((await req(app, "POST", "/x", { headers: { origin: "https://evil.example", host: "localhost" } })).status).toBe(403);
        expect((await req(app, "POST", "/x", { headers: { origin: "http://localhost", host: "localhost" } })).status).toBe(200);
    });
    claim("built-in/csrf#no-headers", "どちらのヘッダーもないリクエストは通す", async () => {
        expect((await req(app, "POST", "/x")).status).toBe(200);
    });
    claim("built-in/csrf#get", "GET は確かめない", async () => {
        expect((await req(app, "GET", "/x", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(200);
    });
    claim("built-in/csrf#allow-origin", "origin に入れたオリジンからは受ける", async () => {
        const a = createApp();
        a.use(csrf({ origin: ["https://admin.example.com"] }));
        a.post("/x", () => "ok");
        expect((await req(a, "POST", "/x", { headers: { "sec-fetch-site": "cross-site", origin: "https://admin.example.com" } })).status).toBe(200);
    });
}

// ---------- built-in/secure-headers ----------
claim("built-in/secure-headers#defaults", "既定で付くもの(表の 11 個)。CSP と COEP は付けない", async () => {
    const app = createApp();
    app.use(secureHeaders());
    app.get("/x", () => "x");
    const r = await req(app, "GET", "/x");
    expect(Object.fromEntries([...r.headers].filter(([k]) => k !== "content-type" && k !== "content-length"))).toEqual({
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
    });
});
claim("built-in/secure-headers#options", "文字列ならその値、false なら付けない。既定のないヘッダーに true はエラー", async () => {
    const app = createApp();
    app.use(secureHeaders({ xFrameOptions: "DENY", strictTransportSecurity: false, contentSecurityPolicy: "default-src 'self'" }));
    app.get("/x", () => "x");
    const r = await req(app, "GET", "/x");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("strict-transport-security")).toBeNull();
    expect(r.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(() => secureHeaders({ contentSecurityPolicy: true })).toThrow();
});

// ---------- built-in/auth ----------
{
    const app = createApp();
    app.use("/admin", basicAuth({ username: "admin", password: "pw" }));
    app.use("/api", bearerAuth({ token: "t" }));
    app.use("/v", basicAuth({ verifyUser: (u, p) => u === "a" && p === "b" }));
    app.get("/admin", () => "a");
    app.get("/api", () => "b");
    app.get("/v", () => "v");
    claim("built-in/auth#401", "通らなければ 401 と WWW-Authenticate", async () => {
        for (const p of ["/admin", "/api"]) {
            const r = await req(app, "GET", p);
            expect(r.status).toBe(401);
            expect(r.headers.get("www-authenticate")).toBeTruthy();
        }
    });
    claim("built-in/auth#pass", "正しい値なら通す", async () => {
        expect((await req(app, "GET", "/admin", { headers: { authorization: `Basic ${btoa("admin:pw")}` } })).status).toBe(200);
        expect((await req(app, "GET", "/api", { headers: { authorization: "Bearer t" } })).status).toBe(200);
    });
    claim("built-in/auth#verify", "verifyUser / verifyToken が true を返したときだけ通す", async () => {
        expect((await req(app, "GET", "/v", { headers: { authorization: `Basic ${btoa("a:b")}` } })).status).toBe(200);
        expect((await req(app, "GET", "/v", { headers: { authorization: `Basic ${btoa("a:x")}` } })).status).toBe(401);
    });
}

// ---------- built-in/jwt ----------
{
    const secret = "s".repeat(32);
    const app = createApp();
    app.use("/api", jwt({ keys: secret, algorithms: ["HS256"] }));
    app.get("/api/me", (_, c) => ({ payload: c.get("jwtPayload") }));
    claim("built-in/jwt#verify", "正しいトークンなら c.get(\"jwtPayload\") に中身", async () => {
        const token = await signJwt({ sub: "42" }, secret, { alg: "HS256", expiresIn: 3600 });
        const r = await req(app, "GET", "/api/me", { headers: { authorization: `Bearer ${token}` } });
        expect((await r.json()).payload.sub).toBe("42");
    });
    claim("built-in/jwt#invalid", 'だめなトークンは 401 と WWW-Authenticate: Bearer error="invalid_token"', async () => {
        const r = await req(app, "GET", "/api/me", { headers: { authorization: "Bearer x.y.z" } });
        expect(r.status).toBe(401);
        expect(r.headers.get("www-authenticate")).toContain('error="invalid_token"');
    });
    claim("built-in/jwt#expired", "exp を確かめる", async () => {
        const token = await signJwt({ sub: "1", exp: Math.floor(Date.now() / 1000) - 60 }, secret, { alg: "HS256" });
        expect((await req(app, "GET", "/api/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    });
    claim("built-in/jwt#required", "algorithms は必須。HS256 の鍵は 32 バイト以上", async () => {
        expect(() => jwt({ keys: secret } as never)).toThrow();
        expect(signJwt({ sub: "1" }, "short", { alg: "HS256" })).rejects.toThrow();
    });
    claim("built-in/jwt#cookie", "cookie: で Cookie から読む", async () => {
        const a = createApp();
        a.use(jwt({ keys: secret, algorithms: ["HS256"], cookie: "token" }));
        a.get("/", (_, c) => ({ payload: c.get("jwtPayload") }));
        const token = await signJwt({ sub: "7" }, secret, { alg: "HS256" });
        expect((await (await req(a, "GET", "/", { headers: { cookie: `token=${token}` } })).json()).payload.sub).toBe("7");
    });
    claim("built-in/jwt#kid", "kid をヘッダーに入れ、同じ kid の鍵で確かめる", async () => {
        const newKey = "n".repeat(32);
        const oldKey = "o".repeat(32);
        const a = createApp();
        a.use(jwt({ keys: [{ kid: "2026-11", key: newKey }, { kid: "2026-10", key: oldKey }], algorithms: ["HS256"] }));
        a.get("/", () => "ok");
        const token = await signJwt({ sub: "1" }, { kid: "2026-10", key: oldKey }, { alg: "HS256" });
        expect(JSON.parse(atob(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"))).kid).toBe("2026-10");
        expect((await req(a, "GET", "/", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    });
}

// ---------- built-in/rate-limit ----------
claim("built-in/rate-limit#429", "超えたら 429 と Retry-After。キーは IP、分からなければ制限しない", async () => {
    const app = createApp();
    app.use(rateLimit({ windowMs: 60_000, limit: 2 }));
    app.get("/x", () => "x");
    await req(app, "GET", "/x");
    await req(app, "GET", "/x");
    const r = await req(app, "GET", "/x");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await req(app, "GET", "/x", { info: ipInfo("10.0.0.9") })).status).toBe(200);
    expect((await quiet(() => req(app, "GET", "/x", { info: {} }))).status).toBe(200);
});
claim("built-in/rate-limit#ipv6", "IPv6 は /64 ごとに数える", async () => {
    const app = createApp();
    app.use(rateLimit({ windowMs: 60_000, limit: 1 }));
    app.get("/x", () => "x");
    await req(app, "GET", "/x", { info: ipInfo("2001:db8:1:2::1") });
    expect((await req(app, "GET", "/x", { info: ipInfo("2001:db8:1:2::ffff") })).status).toBe(429);
    expect((await req(app, "GET", "/x", { info: ipInfo("2001:db8:1:3::1") })).status).toBe(200);
});

// ---------- built-in/ip-restriction ----------
{
    const app = createApp();
    app.use(ipRestriction({ allow: ["192.0.2.0/24"], deny: ["192.0.2.13"] }));
    app.get("/x", () => "x");
    claim("built-in/ip-restriction#deny-first", "deny を先に見る。断ったリクエストは 403", async () => {
        expect((await req(app, "GET", "/x", { info: ipInfo("192.0.2.1") })).status).toBe(200);
        expect((await req(app, "GET", "/x", { info: ipInfo("192.0.2.13") })).status).toBe(403);
        expect((await req(app, "GET", "/x", { info: ipInfo("198.51.100.1") })).status).toBe(403);
    });
    claim("built-in/ip-restriction#unknown", "IP が分からないときも 403。allowUnknown: true で通す", async () => {
        expect((await req(app, "GET", "/x", { info: {} })).status).toBe(403);
        const a = createApp();
        a.use(ipRestriction({ allow: ["10.0.0.0/8"], allowUnknown: true }));
        a.get("/x", () => "x");
        expect((await req(a, "GET", "/x", { info: {} })).status).toBe(200);
    });
    claim("built-in/ip-restriction#trust-proxy", "ip: trustProxy() でプロキシの後ろの IP を使う", async () => {
        const a = createApp();
        a.use(ipRestriction({ allow: ["10.0.0.0/8"], ip: trustProxy({ hops: 1 }) }));
        a.get("/x", () => "x");
        expect((await req(a, "GET", "/x", { info: ipInfo("192.168.0.1"), headers: { "x-forwarded-for": "10.1.2.3" } })).status).toBe(200);
    });
}

// ---------- built-in/body-limit ----------
claim("built-in/body-limit#413", "超えたら 413。onError のオブジェクトは 413 で送る", async () => {
    const app = createApp();
    app.use("/a", bodyLimit({ maxSize: 10 }));
    app.use("/b", bodyLimit({ maxSize: 10, onError: () => ({ error: "too large" }) }));
    app.post("/a", async (_, c) => String((await c.req.text()).length));
    app.post("/b", async (_, c) => String((await c.req.text()).length));
    expect((await req(app, "POST", "/a", { body: "x".repeat(11) })).status).toBe(413);
    const r = await req(app, "POST", "/b", { body: "x".repeat(11) });
    expect([r.status, await r.json()]).toEqual([413, { error: "too large" }]);
});
claim("built-in/body-limit#finite", "maxSize は有限の数", () => {
    expect(() => bodyLimit({ maxSize: Infinity })).toThrow();
});

// ---------- built-in/upload-limit ----------
{
    const app = createApp();
    app.use("/photos", uploadLimit({ maxTotalSize: 1024, maxFileSize: 100, maxFiles: 1, types: ["image/png"] }));
    app.post("/photos", async (_, c) => {
        const { photo } = await c.body<{ photo: File }>();
        return { size: photo.size };
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const send = (file: File) => {
        const form = new FormData();
        form.append("photo", file);
        return req(app, "POST", "/photos", { body: form });
    };
    claim("built-in/upload-limit#ok", "確かめたあと、c.body() で File を受け取れる", async () => {
        expect(await (await send(new File([png], "a.png", { type: "image/png" }))).json()).toEqual({ size: 10 });
    });
    claim("built-in/upload-limit#413-415", "大きすぎれば 413、種類が違えば 415", async () => {
        expect((await send(new File([new Uint8Array(200)], "a.png", { type: "image/png" }))).status).toBe(413);
        expect((await send(new File(["hi"], "a.txt", { type: "text/plain" }))).status).toBe(415);
    });
    claim("built-in/upload-limit#magic", "PNG は中身の先頭のバイトも確かめる", async () => {
        expect((await send(new File(["not png"], "a.png", { type: "image/png" }))).status).toBe(415);
    });
    claim("built-in/upload-limit#safe-file-name", "safeFileName() は ../../etc/passwd のような名前を安全にする", () => {
        const name = safeFileName("../../etc/passwd");
        expect(name.includes("/") || name.includes("..")).toBe(false);
    });
}

// ---------- built-in/timeout ----------
claim("built-in/timeout#504", "時間内に終わらなければ 504", async () => {
    const app = createApp();
    app.use(timeout(50));
    app.get("/slow", async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "late";
    });
    expect((await req(app, "GET", "/slow")).status).toBe(504);
});

// ---------- built-in/compress ----------
claim("built-in/compress#gzip", "Accept-Encoding に合わせて圧縮。1 KB より小さい本文はそのまま", async () => {
    const app = createApp();
    app.use(compress());
    app.get("/big", () => "x".repeat(2000));
    app.get("/small", () => "x".repeat(100));
    expect((await req(app, "GET", "/big", { headers: { "accept-encoding": "gzip" } })).headers.get("content-encoding")).toBe("gzip");
    expect((await req(app, "GET", "/big", { headers: { "accept-encoding": "deflate" } })).headers.get("content-encoding")).toBe("deflate");
    expect((await req(app, "GET", "/small", { headers: { "accept-encoding": "gzip" } })).headers.get("content-encoding")).toBeNull();
});

// ---------- built-in/etag ----------
claim("built-in/etag#304", "弱い ETag、同じなら 304、ハンドラーは毎回動く、HEAD には付けない", async () => {
    const app = createApp();
    let calls = 0;
    app.use(etag());
    app.get("/x", () => (calls++, "hello"));
    const tag = (await req(app, "GET", "/x")).headers.get("etag")!;
    expect(tag.startsWith("W/")).toBe(true);
    expect((await req(app, "GET", "/x", { headers: { "if-none-match": tag } })).status).toBe(304);
    expect(calls).toBe(2);
    expect((await req(app, "HEAD", "/x")).headers.get("etag")).toBeNull();
});

// ---------- built-in/cache ----------
claim("built-in/cache#2xx", "2xx に Cache-Control を付ける。ほかには付けない", async () => {
    const app = createApp();
    app.use(cache({ cacheControl: "public, max-age=3600" }));
    app.get("/x", () => "x");
    app.get("/e", () => {
        throw new HttpError(500, "x");
    });
    expect((await req(app, "GET", "/x")).headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await req(app, "GET", "/e")).headers.get("cache-control")).toBeNull();
});

// ---------- built-in/pretty-json ----------
claim("built-in/pretty-json#pretty", "?pretty で 2 つの空白で整形。なければそのまま", async () => {
    const app = createApp();
    app.use(prettyJSON());
    app.get("/users", () => [{ id: 1, name: "alice" }]);
    expect(await (await req(app, "GET", "/users?pretty")).text()).toBe('[\n  {\n    "id": 1,\n    "name": "alice"\n  }\n]');
    expect(await (await req(app, "GET", "/users")).text()).toBe('[{"id":1,"name":"alice"}]');
});

// ---------- built-in/request-id ----------
claim("built-in/request-id#id", "c.get(\"requestId\") と X-Request-Id。受け取った値は既定で使わない", async () => {
    const app = createApp();
    app.use(requestId());
    app.get("/", (_, c) => `${c.get("requestId")}`);
    const r = await req(app, "GET", "/", { headers: { "x-request-id": "abc" } });
    const id = await r.text();
    expect(id).not.toBe("abc");
    expect(r.headers.get("x-request-id")).toBe(id);
});
claim("built-in/request-id#trust", "trustIncoming: true で受け取った値を使う。使えない文字があれば作り直す", async () => {
    const app = createApp();
    app.use(requestId({ trustIncoming: true }));
    app.get("/", (_, c) => `${c.get("requestId")}`);
    expect(await (await req(app, "GET", "/", { headers: { "x-request-id": "abc" } })).text()).toBe("abc");
    expect(await (await req(app, "GET", "/", { headers: { "x-request-id": "a b" } })).text()).not.toBe("a b");
    expect(await (await req(app, "GET", "/", { headers: { "x-request-id": "a".repeat(129) } })).text()).not.toBe("a".repeat(129));
});

// ---------- built-in/trailing-slash ----------
claim("built-in/trailing-slash#301", "/a/ → /a に 301。ルートに当たらないパスはそのまま", async () => {
    const app = createApp();
    app.use(trailingSlash());
    app.get("/a", () => "a");
    const r = await req(app, "GET", "/a/");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toEndWith("/a");
    expect((await req(app, "GET", "/zzz/")).status).toBe(404);
});

// ---------- built-in/method-override ----------
claim("built-in/method-override#form", "フォームの _method と X-HTTP-Method-Override で、POST を DELETE に", async () => {
    const app = createApp();
    app.delete("/posts/:id", ({ id }) => `deleted ${id}`);
    const wrapped = methodOverride(app);
    const post = (init: RequestInit) => wrapped.fetch(new Request("http://localhost/posts/1", { method: "POST", ...init }), local as never);
    expect(await (await post({ body: new URLSearchParams({ _method: "DELETE" }) })).text()).toBe("deleted 1");
    expect(await (await post({ headers: { "x-http-method-override": "DELETE" } })).text()).toBe("deleted 1");
});

// ---------- built-in/language-detector ----------
claim("built-in/language-detector#order", "クエリ → Cookie → Accept-Language の順。合わなければ fallback。Cookie には書かない", async () => {
    const app = createApp();
    app.use(languageDetector({ supportedLanguages: ["ja", "en"], fallbackLanguage: "en" }));
    app.get("/", (_, c) => `${c.get("language")}`);
    expect(await (await req(app, "GET", "/?lang=ja", { headers: { cookie: "language=en", "accept-language": "en" } })).text()).toBe("ja");
    expect(await (await req(app, "GET", "/", { headers: { cookie: "language=ja", "accept-language": "en" } })).text()).toBe("ja");
    expect(await (await req(app, "GET", "/", { headers: { "accept-language": "ja" } })).text()).toBe("ja");
    expect(await (await req(app, "GET", "/", { headers: { "accept-language": "fr" } })).text()).toBe("en");
    expect((await req(app, "GET", "/", { headers: { "accept-language": "ja" } })).headers.getSetCookie()).toEqual([]);
});

// ---------- built-in/logger ----------
claim("built-in/logger#json", '{ format: "json" } で pino と同じ形の JSON(level は 30)', async () => {
    const lines: string[] = [];
    const { log } = console;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        const app = createApp();
        app.use(logger({ format: "json" }));
        app.get("/x", () => "x");
        await req(app, "GET", "/x");
    } finally {
        console.log = log;
    }
    expect(JSON.parse(lines[0]!).level).toBe(30);
});

// ---------- built-in/health ----------
claim("built-in/health#paths", "/healthz は 200。/readyz は ready() が true なら 200、false なら 503", async () => {
    // ほかのテストで serve() を止めると、止まり始めた状態(/readyz が 503)が残ることがあるので戻す
    setDraining(false);
    let ready = true;
    const app = createApp();
    app.use(health({ ready: () => ready }));
    expect((await req(app, "GET", "/healthz")).status).toBe(200);
    expect((await req(app, "GET", "/readyz")).status).toBe(200);
    ready = false;
    expect((await req(app, "GET", "/readyz")).status).toBe(503);
});
