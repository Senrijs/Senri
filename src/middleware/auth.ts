// Basic 認証と Bearer 認証
import type { Context, Middleware } from "../context.ts";
import { HttpError, senriError } from "../errors.ts";
import { headerOf, markPlainSafe } from "../plain.ts";

/** Options for {@link basicAuth}: a fixed `username` and `password`, or a `verifyUser` function. */
export type BasicAuthOptions = {
    /** The realm in the `WWW-Authenticate` header. Default `"Secure Area"`. */
    realm?: string;
} & (
    | {
          /** The expected username. Must not be empty or contain `:`. */
          username: string;
          /** The expected password. Must not be empty. */
          password: string;
          verifyUser?: never;
      }
    | {
          username?: never;
          password?: never;
          // true を返したときだけ通す。比較はこの関数に任せる(パスワードはハッシュと比べる、など)
          /**
           * Checks the credentials; only `true` lets the request through. Comparing them safely is up to this function
           * (for example, a password hash function made for this purpose).
           */
          verifyUser: (username: string, password: string, c: Context) => boolean | Promise<boolean>;
      }
);

/** Options for {@link bearerAuth}: fixed `token` values, or a `verifyToken` function. */
export type BearerAuthOptions = {
    /** The realm in the `WWW-Authenticate` header. Default `"Secure Area"`. */
    realm?: string;
} & (
    | {
          /** The accepted token, or tokens. They must not be empty, and use only `A-Z a-z 0-9 - . _ ~ + /` and trailing `=`. */
          token: string | readonly string[];
          verifyToken?: never;
      }
    | {
          token?: never;
          /** Checks the token; only `true` lets the request through. Comparing it safely is up to this function. */
          verifyToken: (token: string, c: Context) => boolean | Promise<boolean>;
      }
);

const encoder = new TextEncoder();

// 比べにかかる時間が、どこまで合っていたかで変わらないようにする(node:crypto は Workers やブラウザで使えない)
// 途中で打ち切らず、いつも expected の長さぶん回すので、回数は入力で変わらない
export function safeEqual(input: string, expected: Uint8Array): boolean {
    const bytes = encoder.encode(input);
    let diff = bytes.length ^ expected.length;
    for (let i = 0; i < expected.length; i++) diff |= (bytes[i] ?? 0) ^ expected[i]!;
    return diff === 0;
}

function quotedRealm(realm: string = "Secure Area"): string {
    // ヘッダーの値に入れるので、ASCII の印字できる文字だけ
    if (!/^[\x20-\x7e]*$/.test(realm)) throw senriError("auth_realm", "auth: invalid realm");
    return `realm="${realm.replace(/[\\"]/g, "\\$&")}"`;
}

// c.header() ではなく HttpError の headers で渡す。onError が何を返しても残る
const unauthorized = (challenge: string) => new HttpError(401, "401 Unauthorized", { headers: { "www-authenticate": challenge } });

// Authorization: Basic base64(ユーザー名:パスワード) を読む。読めなければ null
function parseBasic(header: string | null): [username: string, password: string] | null {
    const encoded = header && /^basic +([A-Za-z0-9+/]+={0,2})$/i.exec(header)?.[1];
    if (!encoded) return null;
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0)));
    } catch {
        return null;
    }
    // パスワードには : を使える。ユーザー名には使えない
    const colon = text.indexOf(":");
    return colon === -1 ? null : [text.slice(0, colon), text.slice(colon + 1)];
}

/**
 * Middleware for HTTP Basic authentication. On failure it throws an `HttpError` with status 401 and a
 * `WWW-Authenticate` header, so browsers ask for a password and `app.onError` can change the body.
 *
 * - Fixed credentials are compared in a way that does not reveal how much of them matched
 * - The password travels only base64-encoded, so use HTTPS
 * - Register `cors()` first: preflight requests do not carry credentials
 *
 * Throws when the options are incomplete (an unset environment variable, for example) or the `realm` has characters
 * other than printable ASCII.
 *
 * @example
 * ```ts
 * import { basicAuth, createApp } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use("/admin", basicAuth({ username: "admin", password: "correct horse" }));
 *
 * // Or check them yourself:
 * app.use("/staff", basicAuth({ verifyUser: (username, password) => checkStaff(username, password) }));
 * ```
 */
export function basicAuth(options: BasicAuthOptions): Middleware {
    const { username, password, verifyUser } = options;
    const fixed = typeof username === "string" && typeof password === "string" && username !== "" && password !== "" && !username.includes(":");
    if (verifyUser ? typeof verifyUser !== "function" || username !== undefined || password !== undefined : !fixed) {
        throw senriError("auth_options", "basicAuth(): invalid options");
    }
    const challenge = `Basic ${quotedRealm(options.realm)}, charset="UTF-8"`;
    const expectedUser = fixed ? encoder.encode(username) : null;
    const expectedPassword = fixed ? encoder.encode(password) : null;

    return markPlainSafe<Middleware>(async function basicAuth(c, next) {
        const credentials = parseBasic(headerOf(c, "authorization"));
        if (!credentials) throw unauthorized(challenge);
        const [user, pass] = credentials;
        let ok: boolean;
        if (verifyUser) {
            ok = (await verifyUser(user, pass, c)) === true;
        } else {
            // 片方が違っても、もう片方も比べる
            const userOk = safeEqual(user, expectedUser!);
            const passwordOk = safeEqual(pass, expectedPassword!);
            ok = userOk && passwordOk;
        }
        if (!ok) throw unauthorized(challenge);
        return next();
    });
}

const TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

/**
 * Middleware for Bearer token authentication (`Authorization: Bearer <token>`). On failure it throws an `HttpError`
 * with status 401 and a `WWW-Authenticate` header, so `app.onError` can change the body.
 *
 * - Fixed tokens are all compared, in a way that does not reveal how much of them matched
 * - Register `cors()` first: preflight requests do not carry credentials
 *
 * Throws when the options are incomplete (an unset environment variable, for example), a token has characters that
 * cannot be sent in this header, or the `realm` has characters other than printable ASCII.
 *
 * @example
 * ```ts
 * import { bearerAuth, createApp } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use("/api", bearerAuth({ token: "my-secret-token" }));
 *
 * // Or check it yourself:
 * app.use("/v2", bearerAuth({ verifyToken: (token) => tokens.has(token) }));
 * ```
 */
export function bearerAuth(options: BearerAuthOptions): Middleware {
    const { token, verifyToken } = options;
    const list = token === undefined ? [] : typeof token === "string" ? [token] : token;
    const fixed = Array.isArray(list) && list.length > 0 && list.every((t) => typeof t === "string" && TOKEN.test(t));
    if (verifyToken ? typeof verifyToken !== "function" || token !== undefined : !fixed) {
        throw senriError("auth_options", "bearerAuth(): invalid options");
    }
    const realm = quotedRealm(options.realm);
    const expected = list.map((t) => encoder.encode(t));

    return markPlainSafe<Middleware>(async function bearerAuth(c, next) {
        const header = headerOf(c, "authorization");
        // 何も送っていないときは、error を付けない(RFC 6750)
        if (header === null) throw unauthorized(`Bearer ${realm}`);
        const sent = /^bearer +(\S+)$/i.exec(header)?.[1];
        let ok = false;
        if (sent && TOKEN.test(sent)) {
            if (verifyToken) {
                ok = (await verifyToken(sent, c)) === true;
            } else {
                // 合うものが見つかっても、残りも比べる
                for (const value of expected) ok = safeEqual(sent, value) || ok;
            }
        }
        if (!ok) throw unauthorized(`Bearer ${realm}, error="invalid_token"`);
        return next();
    });
}
