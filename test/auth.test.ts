import { describe, expect, test } from "bun:test";
import { basicAuth, bearerAuth, cors, createApp, type BasicAuthOptions, type BearerAuthOptions } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { safeEqual } from "../src/middleware/auth.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf, CONTEXT_MARKER } from "./bundle.ts";

const req = (authorization?: string, path = "/") => new Request(`http://localhost${path}`, { headers: authorization === undefined ? {} : { authorization } });
const basic = (text: string) => `Basic ${Buffer.from(text).toString("base64")}`;
const bytes = (text: string) => new TextEncoder().encode(text);

function errorOf(run: () => unknown): unknown {
    try {
        run();
    } catch (err) {
        return err;
    }
    return undefined;
}

describe("safeEqual()", () => {
    test("同じときだけ true", () => {
        expect(safeEqual("secret", bytes("secret"))).toBe(true);
        expect(safeEqual("日本語", bytes("日本語"))).toBe(true);
        expect(safeEqual("", bytes(""))).toBe(true);
    });

    test("長さが同じでも、違えば false(どの位置でも)", () => {
        for (const input of ["xecret", "sxcret", "secrex", "SECRET"]) expect(safeEqual(input, bytes("secret"))).toBe(false);
    });

    test("前が同じで、短い・長いときも false", () => {
        for (const input of ["", "s", "secre", "secret ", "secretsecret", "secret\0"]) expect(safeEqual(input, bytes("secret"))).toBe(false);
    });

    test("足りない部分が 0 のバイトでも、長さが違えば false", () => {
        expect(safeEqual("a", bytes("a\0"))).toBe(false);
    });
});

describe("basicAuth()", () => {
    function appWith(options: BasicAuthOptions) {
        const app = createApp();
        app.use(basicAuth(options));
        app.get("/", () => "secret");
        return app;
    }
    const fixed = () => appWith({ username: "admin", password: "pw:with:colons" });
    const CHALLENGE = 'Basic realm="Secure Area", charset="UTF-8"';

    test("合っていれば通す", async () => {
        const res = await fixed().fetch(req(basic("admin:pw:with:colons")));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("secret");
    });

    test("scheme の大文字小文字は問わない", async () => {
        const value = Buffer.from("admin:pw:with:colons").toString("base64");
        for (const scheme of ["basic", "BASIC", "BaSiC"]) {
            expect((await fixed().fetch(req(`${scheme} ${value}`))).status).toBe(200);
        }
    });

    test("UTF-8 のユーザー名とパスワード", async () => {
        const res = await appWith({ username: "管理者", password: "パスワード" }).fetch(req(basic("管理者:パスワード")));

        expect(res.status).toBe(200);
    });

    test("失敗したら 401 と WWW-Authenticate。ハンドラーは動かない", async () => {
        const headers = [
            undefined,
            "",
            basic("admin:wrong"),
            basic("wrong:pw:with:colons"),
            basic("admin"),
            basic(":"),
            "Basic",
            "Basic ",
            "Basic !!!",
            "Basic YQ",
            "Bearer abc",
            `Basic ${Buffer.from([0x61, 0x3a, 0xff]).toString("base64")}`,
        ];
        let called = false;
        const app = createApp();
        app.use(basicAuth({ username: "admin", password: "pw:with:colons" }));
        app.get("/", () => {
            called = true;
            return "secret";
        });
        for (const header of headers) {
            const res = await app.fetch(req(header));

            expect(res.status).toBe(401);
            expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
            expect(await res.text()).toBe("401 Unauthorized");
        }
        expect(called).toBe(false);
    });

    test("realm を変えられる。引用符はエスケープする", async () => {
        const res = await appWith({ username: "a", password: "b", realm: 'My "Area" \\ 1' }).fetch(req());

        expect(res.headers.get("www-authenticate")).toBe('Basic realm="My \\"Area\\" \\\\ 1", charset="UTF-8"');
    });

    test("onError で本文を変えても、WWW-Authenticate は残る", async () => {
        const app = fixed();
        app.onError(() => ({ error: "unauthorized" }));
        const res = await app.fetch(req());

        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
        expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    test("verifyUser: true を返したときだけ通す", async () => {
        const cases: [unknown, number][] = [
            [true, 200],
            [false, 401],
            [1, 401],
            ["true", 401],
            [{}, 401],
            [null, 401],
            [undefined, 401],
        ];
        for (const [result, status] of cases) {
            const app = appWith({ verifyUser: () => result as boolean });
            expect((await app.fetch(req(basic("a:b")))).status).toBe(status);
        }
    });

    test("verifyUser: 非同期でもよい。値と c を受け取る", async () => {
        let seen: unknown[] = [];
        const app = appWith({
            verifyUser: async (username, password, c) => {
                seen = [username, password, c.path];
                return true;
            },
        });

        expect((await app.fetch(req(basic("user:pa:ss")))).status).toBe(200);
        expect(seen).toEqual(["user", "pa:ss", "/"]);
    });

    test("verifyUser: 読めない Authorization では呼ばない", async () => {
        let called = false;
        const app = appWith({
            verifyUser: () => {
                called = true;
                return true;
            },
        });

        expect((await app.fetch(req("Basic !!!"))).status).toBe(401);
        expect(called).toBe(false);
    });

    test("verifyUser が投げたら通さない(500)", async () => {
        const app = appWith({
            verifyUser: () => {
                throw new Error("db down");
            },
        });

        expect((await app.fetch(req(basic("a:b")))).status).toBe(500);
    });

    test("設定が足りなければ、作るときに投げる。開発モードの説明がある", () => {
        const bad = [
            {},
            { username: "a" },
            { password: "b" },
            { username: "", password: "b" },
            { username: "a", password: "" },
            { username: undefined, password: undefined },
            { username: "a:b", password: "c" },
            { username: "a", password: "b", verifyUser: () => true },
            { verifyUser: "yes" },
        ];
        for (const options of bad) {
            expect(explainText(errorOf(() => basicAuth(options as BasicAuthOptions)))).toContain("設定");
        }
    });

    test("realm に使えない文字があれば、作るときに投げる", () => {
        for (const realm of ["a\r\nX-Evil: 1", "a\nb", "日本語"]) {
            expect(explainText(errorOf(() => basicAuth({ username: "a", password: "b", realm })))).toContain("realm");
        }
    });

    test("パス指定で、その下だけを守る", async () => {
        const app = createApp();
        app.use("/admin", basicAuth({ username: "a", password: "b" }));
        app.get("/admin/x", () => "secret");
        app.get("/public", () => "public");

        expect((await app.fetch(req(undefined, "/admin/x"))).status).toBe(401);
        expect((await app.fetch(req(undefined, "/public"))).status).toBe(200);
    });

    test("cors() を先に置くと、プリフライトは通る", async () => {
        const app = createApp();
        app.use(cors());
        app.use(basicAuth({ username: "a", password: "b" }));
        app.get("/", () => "secret");

        const res = await app.fetch(
            new Request("http://localhost/", { method: "OPTIONS", headers: { origin: "https://a.example", "access-control-request-method": "GET" } }),
        );
        expect(res.status).toBe(204);
    });

    test("開発モードでも 401 と WWW-Authenticate を返す", async () => {
        const app = createApp({ dev: devtools() });
        app.use(basicAuth({ username: "a", password: "b" }));
        app.get("/", () => "secret");

        const res = await app.fetch(new Request("http://localhost/", { headers: { host: "localhost", accept: "text/html" } }));
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
    });
});

describe("bearerAuth()", () => {
    function appWith(options: BearerAuthOptions) {
        const app = createApp();
        app.use(bearerAuth(options));
        app.get("/", () => "secret");
        return app;
    }

    test("合っていれば通す", async () => {
        const app = appWith({ token: "abc-._~+/123==" });

        expect((await app.fetch(req("Bearer abc-._~+/123=="))).status).toBe(200);
        expect((await app.fetch(req("bearer abc-._~+/123=="))).status).toBe(200);
    });

    test("複数のトークン", async () => {
        const app = appWith({ token: ["one", "two"] });

        expect((await app.fetch(req("Bearer one"))).status).toBe(200);
        expect((await app.fetch(req("Bearer two"))).status).toBe(200);
        expect((await app.fetch(req("Bearer three"))).status).toBe(401);
    });

    test("何も送っていなければ、401 で error を付けない", async () => {
        const res = await appWith({ token: "abc" }).fetch(req());

        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe('Bearer realm="Secure Area"');
    });

    test("違うとき、形が不正なときも 401 で invalid_token", async () => {
        const app = appWith({ token: "abc" });
        for (const header of ["Bearer wrong", "Bearer abcd", "Bearer ab", "Bearer", "Bearer ", "Bearer a b", "Bearer abc,", "Basic abc", "abc"]) {
            const res = await app.fetch(req(header));

            expect(res.status).toBe(401);
            expect(res.headers.get("www-authenticate")).toBe('Bearer realm="Secure Area", error="invalid_token"');
        }
    });

    test("realm を変えられる", async () => {
        const res = await appWith({ token: "abc", realm: "api" }).fetch(req());

        expect(res.headers.get("www-authenticate")).toBe('Bearer realm="api"');
    });

    test("verifyToken: true を返したときだけ通す", async () => {
        const cases: [unknown, number][] = [
            [true, 200],
            [false, 401],
            [1, 401],
            ["yes", 401],
            [undefined, 401],
        ];
        for (const [result, status] of cases) {
            const app = appWith({ verifyToken: async () => result as boolean });
            expect((await app.fetch(req("Bearer abc"))).status).toBe(status);
        }
    });

    test("verifyToken: 値と c を受け取る。形が不正なら呼ばない", async () => {
        const seen: unknown[] = [];
        const app = appWith({
            verifyToken: (token, c) => {
                seen.push(token, c.path);
                return true;
            },
        });

        expect((await app.fetch(req("Bearer a b"))).status).toBe(401);
        expect(seen).toEqual([]);
        expect((await app.fetch(req("Bearer abc"))).status).toBe(200);
        expect(seen).toEqual(["abc", "/"]);
    });

    test("verifyToken が投げたら通さない(500)", async () => {
        const app = appWith({
            verifyToken: () => {
                throw new Error("db down");
            },
        });

        expect((await app.fetch(req("Bearer abc"))).status).toBe(500);
    });

    test("設定が足りなければ、作るときに投げる。開発モードの説明がある", () => {
        const bad = [
            {},
            { token: undefined },
            { token: "" },
            { token: [] },
            { token: [""] },
            { token: ["ok", ""] },
            { token: "has space" },
            { token: "日本語" },
            { token: "abc", verifyToken: () => true },
            { verifyToken: "yes" },
            { token: 123 },
        ];
        for (const options of bad) {
            expect(explainText(errorOf(() => bearerAuth(options as BearerAuthOptions)))).toContain("設定");
        }
    });
});

describe("印とバンドル", () => {
    test("名前と印", () => {
        const basicMiddleware = basicAuth({ username: "a", password: "b" });
        const bearerMiddleware = bearerAuth({ token: "a" });

        expect(basicMiddleware.name).toBe("basicAuth");
        expect(bearerMiddleware.name).toBe("bearerAuth");
        expect(isPlainSafe(basicMiddleware)).toBe(true);
        expect(isPlainSafe(bearerMiddleware)).toBe(true);
    });

    test("片方だけなら、Context も、もう片方も入らない", async () => {
        const basicCode = await bundleOf("basicAuth");
        const bearerCode = await bundleOf("bearerAuth");

        expect(basicCode).not.toContain(CONTEXT_MARKER);
        expect(basicCode).not.toContain("Bearer");
        expect(bearerCode).not.toContain(CONTEXT_MARKER);
        expect(bearerCode).not.toContain("Basic");
    });

    test("使わなければ、本体に入らない", async () => {
        const code = await bundleOf("createApp");

        expect(code).toContain(CONTEXT_MARKER);
        expect(code).not.toContain("www-authenticate");
    });
});
