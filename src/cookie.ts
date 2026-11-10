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
    /** `Domain`. Not allowed for names starting with `__Host-` (case-insensitive; throws). */
    domain?: string;
    // 既定は "/"
    /** `Path`. Default `"/"`. Must be `"/"` for names starting with `__Host-` (case-insensitive; throws otherwise). */
    path?: string;
    // 既定は true(JavaScript から読めないようにする)
    /** `HttpOnly` (not readable from JavaScript). Default `true`. */
    httpOnly?: boolean;
    // HTTPS のときだけ送る。名前が __Secure- / __Host- で始まるときは常に付く
    /** `Secure` (sent only over HTTPS). Always added for names starting with `__Secure-` or `__Host-` (case-insensitive). */
    secure?: boolean;
    // 既定は "Lax"(よそのサイトからの POST などには付けない)
    /** `SameSite`. Default `"Lax"`. */
    sameSite?: "Strict" | "Lax" | "None";
    /** `Partitioned`. */
    partitioned?: boolean;
};

// Cookie の名前に使える文字(RFC 6265 の token)
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// __Host- / __Secure- の接頭辞か。ブラウザは大文字小文字を区別せずに判定する(RFC 6265bis。Chromium と Firefox 127 以降)
// なので "__HOST-id" も __Host- として扱う(区別すると、Secure が付かずに捨てられ、domain の確認もすり抜ける)
const isHostPrefixed = (name: string) => name.slice(0, 7).toLowerCase() === "__host-";
const isSecurePrefixed = (name: string) => isHostPrefixed(name) || name.slice(0, 9).toLowerCase() === "__secure-";

// 名前と、名前に合わない指定を確かめる
// __Host- で始まる Cookie に Domain を付けると、ブラウザに捨てられる(付けるときも消すときも)。黙って効かないより、エラーにする
// Path も "/" でないと捨てられる。省略すると "/" になるので、明示して "/" 以外のときだけエラー(空文字も "/" にはならない)
function checkName(name: string, options: Pick<CookieOptions, "path" | "domain">): void {
    if (!NAME.test(name)) {
        throw senriError("cookie_name", new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`));
    }
    if (isHostPrefixed(name)) {
        if (options.domain) {
            throw senriError("cookie_host_domain", new TypeError(`__Host- cookies cannot have a Domain: ${name}`));
        }
        if (options.path !== undefined && options.path !== "/") {
            throw senriError("cookie_host_path", new TypeError(`__Host- cookies must have Path=/: ${name}`));
        }
    }
}

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
 * Adds `Secure` for names starting with `__Secure-` or `__Host-` (compared case-insensitively, as browsers do),
 * since browsers ignore such cookies without it.
 * Throws a `TypeError` if the name is not a valid cookie name,
 * or if `domain` (or a `path` other than `"/"`) is given for a name starting with `__Host-` (case-insensitive).
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
    checkName(name, options);
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
    if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
    if (options.domain) parts.push(`Domain=${options.domain}`);
    parts.push(`Path=${options.path ?? "/"}`);
    if (options.httpOnly ?? true) parts.push("HttpOnly");
    // __Secure- / __Host- で始まる名前は、Secure がないとブラウザに捨てられる
    if (options.secure || isSecurePrefixed(name)) parts.push("Secure");
    parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
    if (options.partitioned) parts.push("Partitioned");
    return parts.join("; ");
}

// 消すための Set-Cookie。Path と Domain は、付けたときと同じものを指定する
/**
 * Builds a `Set-Cookie` header value that deletes the cookie. `path` and `domain` must match those used to set it.
 * Adds `Secure` for names starting with `__Secure-` or `__Host-` (compared case-insensitively, as browsers do),
 * since browsers ignore such cookies without it.
 * Throws a `TypeError` if the name is not a valid cookie name,
 * or if `domain` (or a `path` other than `"/"`) is given for a name starting with `__Host-` (case-insensitive).
 */
export function deletionCookie(name: string, options: Pick<CookieOptions, "path" | "domain"> = {}): string {
    checkName(name, options);
    const parts = [`${name}=`, "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
    if (options.domain) parts.push(`Domain=${options.domain}`);
    parts.push(`Path=${options.path ?? "/"}`);
    // __Secure- / __Host- で始まる名前は、消すときも Secure がないとブラウザに捨てられる(serializeCookie と同じ)
    if (isSecurePrefixed(name)) parts.push("Secure");
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
 * Defaults are `Path=/`, `HttpOnly` and `SameSite=Lax`.
 * Adds `Secure` for names starting with `__Secure-` or `__Host-` (compared case-insensitively, as browsers do),
 * since browsers ignore such cookies without it.
 * Throws a `TypeError` if the name is not a valid cookie name,
 * or if `domain` (or a `path` other than `"/"`) is given for a name starting with `__Host-` (case-insensitive).
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
 * Adds `Secure` for names starting with `__Secure-` or `__Host-` (compared case-insensitively, as browsers do),
 * since browsers ignore such cookies without it.
 * Throws a `TypeError` if the name is not a valid cookie name,
 * or if `domain` (or a `path` other than `"/"`) is given for a name starting with `__Host-` (case-insensitive).
 */
export function deleteCookie(c: Context, name: string, options?: Pick<CookieOptions, "path" | "domain">): void {
    c.header("set-cookie", deletionCookie(name, options));
}

// --- 署名付き Cookie ---
// 値の後ろに HMAC-SHA256 の署名を付ける: "<値>.<署名(base64url、43文字)>"
// 署名するのは「名前=値」。名前も入れるので、ある Cookie の署名付きの値を、別の名前の Cookie に写しても通らない
// 確かめるのは crypto.subtle.verify に任せる(Web Crypto の HMAC の verify は、比べる時間が一定になるように作られている)

/**
 * The secret for signed cookies. Pass an array to rotate secrets: the first one signs, and any of them verifies.
 * Use a long random string (32 bytes or more) and keep it out of the source code.
 */
export type CookieSecret = string | readonly string[];

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
    let key = keys.get(secret);
    if (!key) {
        // 秘密鍵は固定のはずなので、少しだけ覚えておく(毎回 importKey しない)。増え続けないよう、多くなったら捨てる
        if (keys.size >= 16) keys.clear();
        key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
            "sign",
            "verify",
        ]);
        keys.set(secret, key);
    }
    return key;
}

function secretsOf(secret: CookieSecret): readonly string[] {
    const list = typeof secret === "string" ? [secret] : secret;
    if (list.length === 0 || list.some((s) => typeof s !== "string" || s === "")) {
        throw senriError("cookie_secret", new TypeError("The cookie secret must be a non-empty string (or a list of them)"));
    }
    return list;
}

const toBase64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");

// 43 文字の base64url(32 バイト)だけを受け付ける。それ以外は null
function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(text)) return null;
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Signs a cookie value with HMAC-SHA256 (Web Crypto) and adds it as a `Set-Cookie` header, like {@link setCookie}.
 * The cookie holds `<value>.<signature>`; the value itself is readable by the client, so do not put secrets in it.
 * The signature covers the name too, so a signed value cannot be moved to a cookie with another name.
 * Read it back with {@link getSignedCookie}.
 * Throws a `TypeError` if the secret is empty, or for the same names and options as {@link setCookie}.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { getSignedCookie, setSignedCookie } from "@senrijs/senri/cookie";
 *
 * const app = createApp<{ Bindings: { COOKIE_SECRET: string } }>();
 * app.post("/login", async (_, c) => {
 *     await setSignedCookie(c, "user", "42", c.env.COOKIE_SECRET, { secure: true, maxAge: 60 * 60 * 24 });
 *     return "ok";
 * });
 * app.get("/me", async (_, c) => (await getSignedCookie(c, "user", c.env.COOKIE_SECRET)) || "guest");
 * ```
 */
export async function setSignedCookie(
    c: Context,
    name: string,
    value: string,
    secret: CookieSecret,
    options?: CookieOptions,
): Promise<void> {
    // 署名する前に名前と指定を確かめる(おかしな名前のまま署名の計算をしない)
    checkName(name, options ?? {});
    const key = await hmacKey(secretsOf(secret)[0]!);
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${name}=${value}`)));
    setCookie(c, name, `${value}.${toBase64url(signature)}`, options);
}

/**
 * Reads a cookie set by {@link setSignedCookie} and checks its signature.
 * Returns the value, `undefined` if the cookie is not sent, or `false` if the signature does not match
 * (the cookie was changed, or signed with another secret or for another name).
 * With a list of secrets, a signature made with any of them is accepted.
 * The signature is checked with `crypto.subtle.verify`, which compares in constant time.
 * Like any cookie, a signed value can be sent again later: `maxAge` only asks the browser to drop it.
 * Throws a `TypeError` if the secret is empty.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { getSignedCookie } from "@senrijs/senri/cookie";
 *
 * const app = createApp<{ Bindings: { COOKIE_SECRET: string } }>();
 * app.get("/me", async (_, c) => {
 *     const user = await getSignedCookie(c, "user", c.env.COOKIE_SECRET);
 *     if (user === false) return c.json({ error: "tampered" }, 400);
 *     return user ?? "guest";
 * });
 * ```
 */
export async function getSignedCookie(c: Context, name: string, secret: CookieSecret): Promise<string | false | undefined> {
    const secrets = secretsOf(secret);
    const raw = getCookie(c, name);
    if (raw === undefined) return undefined;
    const dot = raw.lastIndexOf(".");
    const signature = dot === -1 ? null : fromBase64url(raw.slice(dot + 1));
    if (signature === null) return false;
    const value = raw.slice(0, dot);
    const data = encoder.encode(`${name}=${value}`);
    for (const s of secrets) {
        if (await crypto.subtle.verify("HMAC", await hmacKey(s), signature, data)) return value;
    }
    return false;
}
