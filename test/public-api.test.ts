// 0.3.0 で隠した(意図せず公開していた)ものが、入口から出ていないこと
// 中では使い続けているので、公開しないファイルに移しただけ(src/cookie-header.ts、adapters/serve/port.ts、src/dev/local-url.ts)
import { describe, expect, test } from "bun:test";
import * as cookie from "../src/cookie.ts";
import * as dev from "../src/dev/index.ts";
import * as serve from "../adapters/serve/index.ts";
import { parseCookies } from "../src/cookie-header.ts";
import { DEFAULT_PORT } from "../adapters/serve/port.ts";
import { isLocalUrl } from "../src/dev/local-url.ts";

describe("隠したものは、入口から出ていない", () => {
    test("@senrijs/senri/cookie: parseCookies・serializeCookie・deletionCookie", () => {
        for (const name of ["parseCookies", "serializeCookie", "deletionCookie"]) expect(name in cookie).toBe(false);
        // 代わりに使うもの
        for (const name of ["getCookie", "setCookie", "deleteCookie", "getSignedCookie", "setSignedCookie"]) expect(name in cookie).toBe(true);
    });

    test("@senrijs/senri/serve: resolvePort・DEFAULT_PORT", () => {
        for (const name of ["resolvePort", "DEFAULT_PORT"]) expect(name in serve).toBe(false);
        expect("serve" in serve).toBe(true);
    });

    test("@senrijs/senri/dev: isLocalUrl", () => {
        expect("isLocalUrl" in dev).toBe(false);
        expect("devtools" in dev).toBe(true);
    });

    test("中で使うものは、公開しないファイルから読める", () => {
        expect(parseCookies("a=1")).toEqual({ a: "1" });
        expect(DEFAULT_PORT).toBe(3927);
        expect(isLocalUrl("http://localhost/")).toBe(true);
    });
});
