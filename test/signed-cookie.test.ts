import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { getSignedCookie, setSignedCookie, type CookieSecret } from "../src/cookie.ts";
import { explainText } from "../src/dev/explain.ts";

const SECRET = "a-long-random-secret-for-the-tests-0123456789";

// setSignedCookie で付けた Set-Cookie の「名前=値」(属性を除く。値は URL エンコードのまま)
async function signed(name: string, value: string, secret: CookieSecret = SECRET): Promise<string> {
    const app = createApp();
    app.get("/", async (_, c) => {
        await setSignedCookie(c, name, value, secret);
        return "ok";
    });
    const res = await app.fetch(new Request("http://localhost/"));
    return res.headers.get("set-cookie")!.split(";")[0]!;
}

// Cookie ヘッダーを付けて getSignedCookie の結果を返す
async function read(cookie: string | null, name: string, secret: CookieSecret = SECRET): Promise<string | false | undefined> {
    const app = createApp();
    let result: string | false | undefined;
    app.get("/", async (_, c) => {
        result = await getSignedCookie(c, name, secret);
        return "ok";
    });
    await app.fetch(new Request("http://localhost/", { headers: cookie === null ? {} : { cookie } }));
    return result;
}

describe("署名付き Cookie", () => {
    test("付けた値を、そのまま読める", async () => {
        const cookie = await signed("user", "42");
        expect(cookie).toMatch(/^user=42\.[A-Za-z0-9_-]{43}$/);
        expect(await read(cookie, "user")).toBe("42");
    });

    test("属性は setCookie と同じ(既定は Path=/・HttpOnly・SameSite=Lax)", async () => {
        const app = createApp();
        app.get("/", async (_, c) => {
            await setSignedCookie(c, "__Host-s", "x", SECRET, { maxAge: 60 });
            return "ok";
        });
        const header = (await app.fetch(new Request("http://localhost/"))).headers.get("set-cookie")!;
        expect(header.split("; ").slice(1)).toEqual(["Max-Age=60", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]);
    });

    test("どんな文字の値でも読める(. や ; や日本語や空文字)", async () => {
        for (const value of ["a.b.c", "x; y=z", "日本語 ✓", "", "."]) {
            expect(await read(await signed("v", value), "v")).toBe(value);
        }
    });

    test("送られていなければ undefined", async () => {
        expect(await read(null, "user")).toBeUndefined();
        expect(await read("other=1", "user")).toBeUndefined();
    });

    test("値を書き換えると false", async () => {
        const cookie = await signed("user", "42");
        expect(await read(cookie.replace("user=42.", "user=43."), "user")).toBe(false);
    });

    test("署名を書き換えると false", async () => {
        const cookie = await signed("user", "42");
        const last = cookie.at(-1)!;
        expect(await read(cookie.slice(0, -1) + (last === "A" ? "B" : "A"), "user")).toBe(false);
    });

    test("署名のない値や、形のおかしい署名は false", async () => {
        const cookie = await signed("user", "42");
        const signature = cookie.slice(cookie.lastIndexOf(".") + 1);
        for (const value of ["42", "42.", `42.${signature}=`, `42.${signature.slice(1)}`, `42.${signature}A`, `42.${"!".repeat(43)}`]) {
            expect(await read(`user=${value}`, "user")).toBe(false);
        }
    });

    test("署名の最後の文字の、使われないビットを変えても通らない(同じ署名の別の書き方を受け付けない)", async () => {
        const cookie = await signed("user", "42");
        const last = cookie.at(-1)!;
        // 43 文字目の下位 2 ビットは 0。そこを変えた文字は、atob では同じバイト列になる
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        const other = alphabet[alphabet.indexOf(last) + 1]!;
        expect(await read(cookie.slice(0, -1) + other, "user")).toBe(false);
    });

    test("ほかの秘密鍵で署名したものは false", async () => {
        expect(await read(await signed("user", "42", "another-secret"), "user")).toBe(false);
    });

    test("ほかの名前の Cookie の署名付きの値を写しても false", async () => {
        const cookie = await signed("role", "admin");
        expect(await read(cookie.replace(/^role=/, "user="), "user")).toBe(false);
    });

    test("秘密鍵の配列: 最初の鍵で署名し、どの鍵で署名したものも読める", async () => {
        const rotated = ["new-secret", SECRET];
        const old = await signed("user", "42");
        expect(await read(old, "user", rotated)).toBe("42");
        const fresh = await signed("user", "42", rotated);
        expect(await read(fresh, "user", ["new-secret"])).toBe("42");
        expect(await read(fresh, "user", SECRET)).toBe(false);
    });

    test("秘密鍵が空なら TypeError(code: cookie_secret)", async () => {
        for (const secret of ["", [], ["ok", ""]] as CookieSecret[]) {
            // ハンドラーの中で投げたものは 500 になるので、ハンドラーの中で受け止めて確かめる
            const app = createApp();
            let thrown: unknown;
            app.get("/", async (_, c) => {
                try {
                    await setSignedCookie(c, "user", "42", secret);
                } catch (e) {
                    thrown = e;
                }
                try {
                    await getSignedCookie(c, "user", secret);
                } catch (e) {
                    thrown = [thrown, e];
                }
                return "ok";
            });
            await app.fetch(new Request("http://localhost/", { headers: { cookie: "user=1" } }));
            const [onSet, onGet] = thrown as [unknown, unknown];
            for (const e of [onSet, onGet]) {
                expect(e).toBeInstanceOf(TypeError);
                expect((e as { code?: string }).code).toBe("cookie_secret");
                expect(explainText(e, "ja")).toContain("秘密鍵");
            }
        }
    });

    test("名前がおかしければ、setCookie と同じく TypeError", async () => {
        const app = createApp();
        let thrown: unknown;
        app.get("/", async (_, c) => {
            await setSignedCookie(c, "bad name", "1", SECRET).catch((e: unknown) => (thrown = e));
            return "ok";
        });
        await app.fetch(new Request("http://localhost/"));
        expect((thrown as { code?: string }).code).toBe("cookie_name");
    });
});
