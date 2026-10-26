// Cookie の読み書き(RFC 6265)

export type CookieOptions = {
    // 秒。0 なら消す
    maxAge?: number;
    expires?: Date;
    domain?: string;
    // 既定は "/"
    path?: string;
    // 既定は true(JavaScript から読めないようにする)
    httpOnly?: boolean;
    // HTTPS のときだけ送る。名前が __Secure- / __Host- で始まるときは常に付く
    secure?: boolean;
    // 既定は "Lax"(よそのサイトからの POST などには付けない)
    sameSite?: "Strict" | "Lax" | "None";
    partitioned?: boolean;
};

// Cookie の名前に使える文字(RFC 6265 の token)
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// "Cookie: a=1; b=2" を { a: "1", b: "2" } に。値はデコードする(できなければそのまま)
export function parseCookies(header: string | null): Record<string, string> {
    const out: Record<string, string> = {};
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

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
    if (!NAME.test(name)) {
        throw new TypeError(`Cookie の名前に使えない文字があります: ${JSON.stringify(name)}`);
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
export function deletionCookie(name: string, options: Pick<CookieOptions, "path" | "domain"> = {}): string {
    if (!NAME.test(name)) {
        throw new TypeError(`Cookie の名前に使えない文字があります: ${JSON.stringify(name)}`);
    }
    const parts = [`${name}=`, "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
    if (options.domain) parts.push(`Domain=${options.domain}`);
    parts.push(`Path=${options.path ?? "/"}`);
    return parts.join("; ");
}
