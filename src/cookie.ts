/**
 * Reading and writing cookies (RFC 6265).
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { getCookie, setCookie } from "@senrijs/senri/cookie";
 *
 * const app = createApp();
 * app.get("/", (_, c) => {
 *     setCookie(c, "visited", "1", { maxAge: 60 * 60 });
 *     return getCookie(c, "visited") ?? "first visit";
 * });
 * ```
 *
 * @module
 */
// Cookie の読み書き(RFC 6265)
import type { Context } from "./context.ts";
import { senriError } from "./errors.ts";

/** Attributes of a `Set-Cookie` header. */
export type CookieOptions = {
    // 秒。0 なら消す
    /** `Max-Age` in seconds (rounded down). `0` makes the cookie expire immediately. */
    maxAge?: number;
    /** `Expires`. */
    expires?: Date;
    /** `Domain`. */
    domain?: string;
    // 既定は "/"
    /** `Path`. Default `"/"`. */
    path?: string;
    // 既定は true(JavaScript から読めないようにする)
    /** `HttpOnly` (not readable from JavaScript). Default `true`. */
    httpOnly?: boolean;
    // HTTPS のときだけ送る。名前が __Secure- / __Host- で始まるときは常に付く
    /** `Secure` (sent only over HTTPS). Always added for names starting with `__Secure-` or `__Host-`. */
    secure?: boolean;
    // 既定は "Lax"(よそのサイトからの POST などには付けない)
    /** `SameSite`. Default `"Lax"`. */
    sameSite?: "Strict" | "Lax" | "None";
    /** `Partitioned`. */
    partitioned?: boolean;
};

// Cookie の名前に使える文字(RFC 6265 の token)
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// "Cookie: a=1; b=2" を { a: "1", b: "2" } に。値はデコードする(できなければそのまま)
/**
 * Parses a `Cookie` header into an object without a prototype (`"a=1; b=2"` → `{ a: "1", b: "2" }`).
 * Values are URI-decoded (kept as is if decoding fails) and surrounding double quotes are removed.
 * For repeated names, the first value is used. `null` gives an empty object.
 */
export function parseCookies(header: string | null): Record<string, string> {
    // プロトタイプのないオブジェクト(ふつうの {} だと "constructor" などの名前が継承したものと混ざる)
    const out: Record<string, string> = Object.create(null);
    if (!header) return out;
    for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        const name = part.slice(0, eq).trim();
        if (!name || name in out) continue;
        let value = part.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        try {
            out[name] = decodeURIComponent(value);
        } catch {
            out[name] = value;
        }
    }
    return out;
}

/**
 * Builds a `Set-Cookie` header value. The value is URI-encoded; defaults are `Path=/`, `HttpOnly` and `SameSite=Lax`.
 * Throws a `TypeError` if the name is not a valid cookie name.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
    if (!NAME.test(name)) {
        throw senriError("cookie_name", new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`));
    }
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
    if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
    if (options.domain) parts.push(`Domain=${options.domain}`);
    parts.push(`Path=${options.path ?? "/"}`);
    if (options.httpOnly ?? true) parts.push("HttpOnly");
    // __Secure- / __Host- で始まる名前は、Secure がないとブラウザに捨てられる
    if (options.secure || name.startsWith("__Secure-") || name.startsWith("__Host-")) parts.push("Secure");
    parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
    if (options.partitioned) parts.push("Partitioned");
    return parts.join("; ");
}

// 消すための Set-Cookie。Path と Domain は、付けたときと同じものを指定する
/**
 * Builds a `Set-Cookie` header value that deletes the cookie. `path` and `domain` must match those used to set it.
 * Throws a `TypeError` if the name is not a valid cookie name.
 */
export function deletionCookie(name: string, options: Pick<CookieOptions, "path" | "domain"> = {}): string {
    if (!NAME.test(name)) {
        throw senriError("cookie_name", new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`));
    }
    const parts = [`${name}=`, "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
    if (options.domain) parts.push(`Domain=${options.domain}`);
    parts.push(`Path=${options.path ?? "/"}`);
    return parts.join("; ");
}

// --- @senrijs/senri/cookie の入口 ---
// Context のメソッドにしないのは、使わないアプリのバンドルに入れないため(0.1 の c.cookie / c.setCookie / c.deleteCookie)

// getCookie(c, "session") で1つ(なければ undefined)、getCookie(c) で全部
/**
 * Reads all cookies of the request as an object.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { getCookie } from "@senrijs/senri/cookie";
 *
 * const app = createApp();
 * app.get("/cookies", (_, c) => getCookie(c));
 * ```
 */
export function getCookie(c: Context): Record<string, string>;
/**
 * Reads one cookie of the request, or `undefined` if it is not sent.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { getCookie } from "@senrijs/senri/cookie";
 *
 * const app = createApp();
 * app.get("/", (_, c) => (getCookie(c, "session") ? "signed in" : "guest"));
 * ```
 */
export function getCookie(c: Context, name: string): string | undefined;
/** Reads one cookie of the request (with `name`), or all of them (without it). */
export function getCookie(c: Context, name?: string): string | undefined | Record<string, string> {
    const all = parseCookies(c.req.headers.get("cookie"));
    return name === undefined ? { ...all } : all[name];
}

// 既定は Path=/・HttpOnly・SameSite=Lax。最後に1回だけレスポンスに足される(c.header と同じ)
/**
 * Adds a `Set-Cookie` header to the response (through `c.header()`, so it is added once at the end).
 * Defaults are `Path=/`, `HttpOnly` and `SameSite=Lax`. Throws a `TypeError` if the name is not a valid cookie name.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { setCookie } from "@senrijs/senri/cookie";
 *
 * const app = createApp();
 * app.post("/login", (_, c) => {
 *     setCookie(c, "session", "abc123", { secure: true, maxAge: 60 * 60 * 24 });
 *     return "ok";
 * });
 * ```
 */
export function setCookie(c: Context, name: string, value: string, options?: CookieOptions): void {
    c.header("set-cookie", serializeCookie(name, value, options));
}

// Path と Domain は、付けたときと同じものを指定する
/**
 * Adds a `Set-Cookie` header that deletes the cookie. `path` and `domain` must match those used to set it.
 * Throws a `TypeError` if the name is not a valid cookie name.
 */
export function deleteCookie(c: Context, name: string, options?: Pick<CookieOptions, "path" | "domain">): void {
    c.header("set-cookie", deletionCookie(name, options));
}
