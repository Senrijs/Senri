// Cookie のヘッダーの読み書き(RFC 6265)。公開しない部品(package.json / jsr.json の exports に載せない)
// - 公開の入口は src/cookie.ts(getCookie / setCookie / deleteCookie / 署名付き Cookie)
// - 中では jwt.ts と middleware/language-detector.ts も使う
// 0.3.0 で、parseCookies / serializeCookie / deletionCookie を @senrijs/senri/cookie から外した(意図せず公開していたもの)
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
export function checkName(name: string, options: Pick<CookieOptions, "path" | "domain">): void {
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
