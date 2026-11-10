/**
 * Signing and verifying JSON Web Tokens (JWT, RFC 7519) with Web Crypto, and middleware that verifies them.
 * The algorithms to accept must always be given, and `none` is never accepted.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { jwt, signJwt, type JwtVariables } from "@senrijs/senri/jwt";
 *
 * const secret = process.env.JWT_SECRET!; // 32 bytes or more for HS256
 * const app = createApp<JwtVariables>();
 * app.post("/login", async () => ({ token: await signJwt({ sub: "42" }, secret, { alg: "HS256", expiresIn: 3600 }) }));
 * app.use("/api", jwt({ keys: secret, algorithms: ["HS256"] }));
 * app.get("/api/me", (_, c) => ({ user: c.get("jwtPayload")?.sub }));
 * ```
 *
 * @module
 */
// JWT(RFC 7519)の署名と確認。暗号は Web Crypto だけで書く(Bun・Deno・Node.js・Workers・ブラウザで同じに動く)
// 受け付けるアルゴリズムは必ず指定させる。"none" は決して受け付けない
// 本体を太らせないよう、別の入口(@senrijs/senri/jwt)にしている
import type { Context, Middleware } from "./context.ts";
import { parseCookies } from "./cookie.ts";
import { HttpError, senriError } from "./errors.ts";
import { headerOf, markPlainSafe } from "./plain.ts";

/**
 * The algorithms that {@link signJwt} and {@link verifyJwt} support. `none` is not one of them.
 * `Ed25519` (RFC 9864) and `EdDSA` both mean Ed25519 signatures; a token's `alg` must still be in `algorithms` as written.
 */
export type JwtAlgorithm =
    | "HS256"
    | "HS384"
    | "HS512"
    | "RS256"
    | "RS384"
    | "RS512"
    | "PS256"
    | "PS384"
    | "PS512"
    | "ES256"
    | "ES384"
    | "EdDSA"
    | "Ed25519";

/** The registered claims of a JWT (RFC 7519), and any others. Times are in seconds since the epoch. */
export type JwtPayload = {
    /** Issuer. */
    iss?: string;
    /** Subject. */
    sub?: string;
    /** Audience. */
    aud?: string | string[];
    /** Expiration time, in seconds since the epoch. */
    exp?: number;
    /** Not before, in seconds since the epoch. */
    nbf?: number;
    /** Issued at, in seconds since the epoch. */
    iat?: number;
    /** JWT ID. */
    jti?: string;
    [claim: string]: unknown;
};

/** A JSON Web Key, with the `kid` and `alg` members that the DOM type leaves out. */
export type JwtJwk = JsonWebKey & { kid?: string };

/**
 * A key for {@link signJwt} or {@link verifyJwt}:
 * - A string: an HMAC secret (HS256 / HS384 / HS512), at least as long as the hash (32, 48 or 64 bytes),
 *   or a PEM key for the other algorithms (`-----BEGIN PUBLIC KEY-----` to verify, `-----BEGIN PRIVATE KEY-----` to sign)
 * - A `CryptoKey`
 * - A JWK (`{ kty: "RSA", n, e, kid }` and so on)
 * - `{ kid, key }`, to give one of the above a key ID
 */
export type JwtKey = string | CryptoKey | JwtJwk | { kid?: string; key: string | CryptoKey | JwtJwk };

/**
 * Raised when a token is not accepted. It is an {@link HttpError} with status 401 and a
 * `WWW-Authenticate: Bearer error="invalid_token"` header, so an uncaught one answers 401.
 */
export class JwtError extends HttpError {
    /**
     * Why the token was not accepted: `"malformed"`, `"algorithm"` (not in `algorithms`), `"key"` (no key fits),
     * `"signature"`, `"expired"`, `"not_before"`, `"max_age"`, `"issuer"`, `"audience"`, `"subject"`, `"claim"` (a
     * claim has the wrong type) or `"missing"` (no token was sent; only from {@link jwt}).
     */
    readonly reason: JwtErrorReason;

    /** Created by Senri when a token is not accepted. */
    constructor(reason: JwtErrorReason, challenge: string = 'Bearer error="invalid_token"') {
        super(401, `401 Unauthorized: ${MESSAGES[reason]}`, { headers: { "www-authenticate": challenge } });
        this.name = "JwtError";
        this.reason = reason;
    }
}

/** The values of {@link JwtError.reason}. */
export type JwtErrorReason =
    | "malformed"
    | "algorithm"
    | "key"
    | "signature"
    | "expired"
    | "not_before"
    | "max_age"
    | "issuer"
    | "audience"
    | "subject"
    | "claim"
    | "missing";

const MESSAGES: Record<JwtErrorReason, string> = {
    malformed: "malformed token",
    algorithm: "algorithm not allowed",
    key: "no key for this token",
    signature: "invalid signature",
    expired: "token expired",
    not_before: "token not yet valid",
    max_age: "token too old",
    issuer: "unexpected issuer",
    audience: "unexpected audience",
    subject: "unexpected subject",
    claim: "invalid claim",
    missing: "no token",
};

type Spec = {
    name: "HMAC" | "RSASSA-PKCS1-v1_5" | "RSA-PSS" | "ECDSA" | "Ed25519";
    hash?: "SHA-256" | "SHA-384" | "SHA-512";
    curve?: "P-256" | "P-384";
    // JWK の kty
    kty: "oct" | "RSA" | "EC" | "OKP";
};

const SPECS: Record<JwtAlgorithm, Spec> = {
    HS256: { name: "HMAC", hash: "SHA-256", kty: "oct" },
    HS384: { name: "HMAC", hash: "SHA-384", kty: "oct" },
    HS512: { name: "HMAC", hash: "SHA-512", kty: "oct" },
    RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", kty: "RSA" },
    RS384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384", kty: "RSA" },
    RS512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512", kty: "RSA" },
    PS256: { name: "RSA-PSS", hash: "SHA-256", kty: "RSA" },
    PS384: { name: "RSA-PSS", hash: "SHA-384", kty: "RSA" },
    PS512: { name: "RSA-PSS", hash: "SHA-512", kty: "RSA" },
    ES256: { name: "ECDSA", hash: "SHA-256", curve: "P-256", kty: "EC" },
    ES384: { name: "ECDSA", hash: "SHA-384", curve: "P-384", kty: "EC" },
    EdDSA: { name: "Ed25519", kty: "OKP" },
    Ed25519: { name: "Ed25519", kty: "OKP" },
};

// プロトタイプの "toString" などを、アルゴリズムの名前として受け付けない
const specOf = (alg: unknown): Spec | undefined => (typeof alg === "string" && Object.hasOwn(SPECS, alg) ? SPECS[alg as JwtAlgorithm] : undefined);

const hashBytes = (hash: Spec["hash"]) => (hash === "SHA-512" ? 64 : hash === "SHA-384" ? 48 : 32);

function importParams(spec: Spec): HmacImportParams | RsaHashedImportParams | EcKeyImportParams | Algorithm {
    if (spec.name === "ECDSA") return { name: spec.name, namedCurve: spec.curve! };
    if (spec.name === "Ed25519") return { name: spec.name };
    return { name: spec.name, hash: spec.hash! };
}

function signParams(spec: Spec): Algorithm | RsaPssParams | EcdsaParams {
    if (spec.name === "RSA-PSS") return { name: spec.name, saltLength: hashBytes(spec.hash) };
    if (spec.name === "ECDSA") return { name: spec.name, hash: spec.hash! };
    return { name: spec.name };
}

// --- base64url ---

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function toBase64url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// 厳密に読む: base64url の文字だけ、= なし、使われないビットが 0(同じバイト列の別の書き方を受け付けない)
function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return toBase64url(bytes) === text ? bytes : null;
}

function jsonObject(text: string): Record<string, unknown> | null {
    const bytes = fromBase64url(text);
    if (bytes === null) return null;
    try {
        const value: unknown = JSON.parse(decoder.decode(bytes));
        return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

// --- 鍵 ---

const keyError = (message: string) => senriError("jwt_key", new TypeError(`jwt: ${message}`));

type Entry = { kid: string | undefined; key: string | CryptoKey | JwtJwk };

function entryOf(key: JwtKey): Entry {
    if (typeof key === "object" && key !== null && "key" in key && !(key instanceof CryptoKey)) {
        const inner = key.key;
        const kid = key.kid ?? (typeof inner === "object" && !(inner instanceof CryptoKey) ? inner.kid : undefined);
        return { kid, key: inner };
    }
    if (typeof key === "string" || key instanceof CryptoKey) return { kid: undefined, key };
    if (typeof key === "object" && key !== null && typeof (key as JwtJwk).kty === "string") return { kid: (key as JwtJwk).kid, key };
    throw keyError("a key must be a string, a CryptoKey, a JWK or { kid, key }");
}

function entriesOf(keys: JwtKey | readonly JwtKey[]): Entry[] {
    const list = Array.isArray(keys) ? (keys as readonly JwtKey[]) : [keys as JwtKey];
    if (list.length === 0) throw keyError("give at least one key");
    return list.map(entryOf);
}

const PEM = /^-----BEGIN ([A-Z ]+)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----\s*$/;

// 読み込んだ鍵を覚えておく(毎回 importKey しない)。文字列の鍵は増え続けないよう、多くなったら捨てる
const objectKeys = new WeakMap<object, Map<string, Promise<CryptoKey | null>>>();
const stringKeys = new Map<string, Promise<CryptoKey | null>>();

// このアルゴリズムと使い方(sign / verify)に使える CryptoKey。合わない鍵なら null(ほかの鍵を試す)
// 鍵そのものがおかしい(短すぎる HMAC の秘密鍵、読めない PEM など)ときは TypeError
function cryptoKeyFor(key: string | CryptoKey | JwtJwk, alg: JwtAlgorithm, usage: "sign" | "verify"): Promise<CryptoKey | null> {
    const id = `${alg} ${usage}`;
    if (typeof key === "string") {
        const cacheKey = `${id} ${key}`;
        let found = stringKeys.get(cacheKey);
        if (!found) {
            if (stringKeys.size >= 32) stringKeys.clear();
            found = importString(key, alg, usage);
            stringKeys.set(cacheKey, found);
            found.catch(() => stringKeys.delete(cacheKey));
        }
        return found;
    }
    let cache = objectKeys.get(key);
    if (!cache) objectKeys.set(key, (cache = new Map()));
    let found = cache.get(id);
    if (!found) {
        found = key instanceof CryptoKey ? Promise.resolve(fits(key, alg, usage) ? key : null) : importJwk(key, alg, usage);
        cache.set(id, found);
        found.catch(() => cache.delete(id));
    }
    return found;
}

function fits(key: CryptoKey, alg: JwtAlgorithm, usage: "sign" | "verify"): boolean {
    const spec = SPECS[alg];
    const algorithm = key.algorithm as { name: string; hash?: { name: string }; namedCurve?: string };
    if (algorithm.name !== spec.name) return false;
    if (spec.hash && spec.name !== "ECDSA" && algorithm.hash?.name !== spec.hash) return false;
    if (spec.curve && algorithm.namedCurve !== spec.curve) return false;
    if (!key.usages.includes(usage)) return false;
    return spec.name === "HMAC" ? key.type === "secret" : key.type === (usage === "sign" ? "private" : "public");
}

async function importString(key: string, alg: JwtAlgorithm, usage: "sign" | "verify"): Promise<CryptoKey | null> {
    const spec = SPECS[alg];
    const pem = PEM.exec(key);
    if (spec.name === "HMAC") {
        // PEM の公開鍵を HMAC の秘密鍵として使わせない(アルゴリズムの取り違えの攻撃)
        if (key.startsWith("-----BEGIN")) return null;
        const bytes = encoder.encode(key);
        if (bytes.length < hashBytes(spec.hash)) {
            throw keyError(`the ${alg} secret must be at least ${hashBytes(spec.hash)} bytes (RFC 7518)`);
        }
        return crypto.subtle.importKey("raw", bytes, importParams(spec), false, [usage]);
    }
    if (pem === null) {
        // HMAC の秘密鍵(PEM でない文字列)は、ほかのアルゴリズムの鍵には使わない
        if (!key.startsWith("-----BEGIN")) return null;
        throw keyError("could not read the PEM key");
    }
    const label = pem[1];
    const format = label === "PUBLIC KEY" ? "spki" : label === "PRIVATE KEY" ? "pkcs8" : null;
    if (format === null) {
        throw keyError(`PEM "${label}" is not supported. Use "PUBLIC KEY" (SPKI) or "PRIVATE KEY" (PKCS #8)`);
    }
    if ((format === "spki") !== (usage === "verify")) return null;
    const der = Uint8Array.from(atob(pem[2]!.replace(/\s+/g, "")), (ch) => ch.charCodeAt(0));
    try {
        return await crypto.subtle.importKey(format, der, importParams(spec), false, [usage]);
    } catch {
        // ほかの種類の鍵(EC の鍵を RS256 で、など)は、この alg には使えない
        return null;
    }
}

const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth"];

async function importJwk(jwk: JwtJwk, alg: JwtAlgorithm, usage: "sign" | "verify"): Promise<CryptoKey | null> {
    const spec = SPECS[alg];
    if (jwk.kty !== spec.kty) return null;
    // Ed25519 の鍵の alg は、"EdDSA" とも "Ed25519"(RFC 9864)とも書かれる
    if (jwk.alg !== undefined && jwk.alg !== alg && !(spec.name === "Ed25519" && (jwk.alg === "EdDSA" || jwk.alg === "Ed25519"))) return null;
    if (jwk.use !== undefined && jwk.use !== "sig") return null;
    if (spec.curve && jwk.crv !== spec.curve) return null;
    if (spec.name === "Ed25519" && jwk.crv !== "Ed25519") return null;
    const isPrivate = spec.name !== "HMAC" && jwk.d !== undefined;
    if (usage === "sign" && spec.name !== "HMAC" && !isPrivate) return null;
    // 確かめるときは公開鍵の部分だけ使う(秘密鍵の JWK を渡されても、verify には公開鍵が要る)
    const material: JsonWebKey = { ...jwk };
    delete (material as JwtJwk).kid;
    delete material.key_ops;
    delete material.use;
    if (usage === "verify" && isPrivate) for (const name of PRIVATE_MEMBERS) delete (material as Record<string, unknown>)[name];
    if (spec.name === "HMAC") {
        const bytes = typeof jwk.k === "string" ? fromBase64url(jwk.k) : null;
        if (bytes === null) throw keyError("the oct JWK has no valid k");
        if (bytes.length < hashBytes(spec.hash)) {
            throw keyError(`the ${alg} secret must be at least ${hashBytes(spec.hash)} bytes (RFC 7518)`);
        }
    }
    try {
        return await crypto.subtle.importKey("jwk", material, importParams(spec), false, [usage]);
    } catch (err) {
        throw keyError(`could not import the JWK (${err instanceof Error ? err.message : String(err)})`);
    }
}

function checkAlgorithms(algorithms: unknown): readonly JwtAlgorithm[] {
    if (!Array.isArray(algorithms) || algorithms.length === 0) {
        throw senriError("jwt_algorithms", new TypeError('jwt: give the accepted algorithms, such as algorithms: ["HS256"]'));
    }
    for (const alg of algorithms) {
        if (specOf(alg) === undefined) {
            throw senriError("jwt_algorithms", new TypeError(`jwt: unsupported algorithm: ${JSON.stringify(alg)}`));
        }
    }
    return algorithms as readonly JwtAlgorithm[];
}

// --- 署名 ---

/** Options for {@link signJwt}. */
export type SignJwtOptions = {
    /** The algorithm. Required; `none` is not supported. */
    alg: JwtAlgorithm;
    // 何秒後に期限切れにするか(exp)
    /** Sets `exp` to this many seconds from now. Without it, the token does not expire unless the payload has `exp`. */
    expiresIn?: number;
    /** The `kid` header. Default: the `kid` of the key (`{ kid, key }` or a JWK's `kid`). */
    kid?: string;
};

/**
 * Signs a JWT. Adds `iat` (now) unless the payload has it, and `exp` with `expiresIn`.
 * Throws a `TypeError` for an unsupported algorithm, or a key that does not fit it (such as an HMAC secret shorter than
 * the hash, or a public key).
 *
 * @example
 * ```ts
 * import { signJwt } from "@senrijs/senri/jwt";
 *
 * const token = await signJwt({ sub: "42", role: "admin" }, process.env.JWT_SECRET!, { alg: "HS256", expiresIn: 60 * 60 });
 * ```
 */
export async function signJwt(payload: JwtPayload, key: JwtKey, options: SignJwtOptions): Promise<string> {
    const alg = checkAlgorithms([options?.alg])[0]!;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw senriError("jwt_payload", new TypeError("jwt: the payload must be an object"));
    }
    const entry = entryOf(key);
    const cryptoKey = await cryptoKeyFor(entry.key, alg, "sign");
    if (cryptoKey === null) throw keyError(`the key cannot sign ${alg} tokens (it may be a public key, or for another algorithm)`);

    const now = Math.floor(Date.now() / 1000);
    const claims: JwtPayload = { iat: now, ...payload };
    if (options.expiresIn !== undefined) {
        if (!Number.isFinite(options.expiresIn)) throw senriError("jwt_payload", new TypeError("jwt: expiresIn must be a number of seconds"));
        claims.exp = now + Math.floor(options.expiresIn);
    }
    const kid = options.kid ?? entry.kid;
    const header = kid === undefined ? { alg, typ: "JWT" } : { alg, typ: "JWT", kid };
    const input = `${toBase64url(encoder.encode(JSON.stringify(header)))}.${toBase64url(encoder.encode(JSON.stringify(claims)))}`;
    const signature = await crypto.subtle.sign(signParams(SPECS[alg]), cryptoKey, encoder.encode(input));
    return `${input}.${toBase64url(new Uint8Array(signature))}`;
}

// --- 確認 ---

/** Options for {@link verifyJwt}. */
export type VerifyJwtOptions = {
    // 受け付けるアルゴリズム。必須
    /** The algorithms to accept. Required: the token's own `alg` is only trusted if it is in this list. */
    algorithms: readonly JwtAlgorithm[];
    /** The accepted `iss`. */
    issuer?: string | readonly string[];
    /** The accepted `aud`: the token must name at least one of these. */
    audience?: string | readonly string[];
    /** The accepted `sub`. */
    subject?: string;
    // 時計のずれを、何秒まで許すか
    /** Seconds of clock difference to allow for `exp`, `nbf` and `maxAge`. Default `0`. */
    clockTolerance?: number;
    // iat から何秒までのトークンを受け付けるか
    /** Reject tokens whose `iat` is more than this many seconds ago (or that have no `iat`). */
    maxAge?: number;
};

// トークンの長さの上限。とても長いものを、base64 や JSON として読まない
const MAX_TOKEN_LENGTH = 16 * 1024;

const isStringList = (value: unknown): value is string | string[] =>
    typeof value === "string" || (Array.isArray(value) && value.every((v) => typeof v === "string"));

/**
 * Verifies a JWT and returns its payload. Throws a {@link JwtError} (401) when the token is not accepted, and a
 * `TypeError` for wrong options (no `algorithms`, an unsupported algorithm, an unusable key).
 *
 * - The token's `alg` must be in `algorithms`, and the key must be of that algorithm's kind: a public RSA key is never
 *   used as an HMAC secret. `none` is never accepted. Tokens with a `crit` header are rejected
 * - Pass several keys to rotate them. If the token has a `kid`, only keys with that `kid` (and keys without one) are
 *   tried; otherwise every key that fits the algorithm is tried
 * - `exp` and `nbf` are checked when present; give `expiresIn` when signing, or check `exp` yourself, if tokens must
 *   expire
 *
 * @example
 * ```ts
 * import { verifyJwt } from "@senrijs/senri/jwt";
 *
 * const payload = await verifyJwt(token, [{ kid: "2026-11", key: newSecret }, { kid: "2026-10", key: oldSecret }], {
 *     algorithms: ["HS256"],
 *     issuer: "https://auth.example.com",
 * });
 * ```
 */
export async function verifyJwt<T extends JwtPayload = JwtPayload>(token: string, keys: JwtKey | readonly JwtKey[], options: VerifyJwtOptions): Promise<T> {
    const algorithms = checkAlgorithms(options?.algorithms);
    const entries = entriesOf(keys);

    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) throw new JwtError("malformed");
    const parts = token.split(".");
    if (parts.length !== 3) throw new JwtError("malformed");
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = jsonObject(encodedHeader);
    const payload = jsonObject(encodedPayload);
    const signature = fromBase64url(encodedSignature);
    if (header === null || payload === null || signature === null) throw new JwtError("malformed");

    const alg = header.alg;
    if (typeof alg !== "string" || !algorithms.includes(alg as JwtAlgorithm)) throw new JwtError("algorithm");
    // 知らない拡張(crit)は理解できないので、受け付けない(RFC 7515 4.1.11)
    if (header.crit !== undefined) throw new JwtError("malformed");
    const kid = header.kid;
    if (kid !== undefined && typeof kid !== "string") throw new JwtError("malformed");

    const data = encoder.encode(`${encodedHeader}.${encodedPayload}`);
    let tried = false;
    let verified = false;
    for (const entry of entries) {
        if (kid !== undefined && entry.kid !== undefined && entry.kid !== kid) continue;
        const cryptoKey = await cryptoKeyFor(entry.key, alg as JwtAlgorithm, "verify");
        if (cryptoKey === null) continue;
        tried = true;
        if (await crypto.subtle.verify(signParams(SPECS[alg as JwtAlgorithm]), cryptoKey, signature, data)) {
            verified = true;
            break;
        }
    }
    if (!tried) throw new JwtError("key");
    if (!verified) throw new JwtError("signature");

    checkClaims(payload, options);
    return payload as T;
}

function checkClaims(payload: JwtPayload, options: VerifyJwtOptions): void {
    const now = Date.now() / 1000;
    const tolerance = options.clockTolerance ?? 0;
    for (const name of ["exp", "nbf", "iat"] as const) {
        const value = payload[name];
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) throw new JwtError("claim");
    }
    for (const name of ["iss", "sub", "jti"] as const) {
        if (payload[name] !== undefined && typeof payload[name] !== "string") throw new JwtError("claim");
    }
    if (payload.aud !== undefined && !isStringList(payload.aud)) throw new JwtError("claim");

    if (payload.exp !== undefined && now >= payload.exp + tolerance) throw new JwtError("expired");
    if (payload.nbf !== undefined && now + tolerance < payload.nbf) throw new JwtError("not_before");
    if (options.maxAge !== undefined && (payload.iat === undefined || now - payload.iat > options.maxAge + tolerance)) {
        throw new JwtError("max_age");
    }
    if (options.issuer !== undefined) {
        const accepted = typeof options.issuer === "string" ? [options.issuer] : options.issuer;
        if (payload.iss === undefined || !accepted.includes(payload.iss)) throw new JwtError("issuer");
    }
    if (options.audience !== undefined) {
        const accepted = typeof options.audience === "string" ? [options.audience] : options.audience;
        const audiences = payload.aud === undefined ? [] : typeof payload.aud === "string" ? [payload.aud] : payload.aud;
        if (!audiences.some((aud) => accepted.includes(aud))) throw new JwtError("audience");
    }
    if (options.subject !== undefined && payload.sub !== options.subject) throw new JwtError("subject");
}

// --- ミドルウェア ---

/**
 * The variables {@link jwt} sets: `c.get("jwtPayload")` is the verified payload.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import type { JwtVariables } from "@senrijs/senri/jwt";
 *
 * const app = createApp<JwtVariables<{ sub: string; role: "admin" | "user" }>>();
 * ```
 */
export type JwtVariables<T extends JwtPayload = JwtPayload> = {
    /** The verified payload of the request's token. */
    jwtPayload: T;
};

/** Options for {@link jwt}. */
export type JwtOptions = VerifyJwtOptions & {
    /** The key, or keys to rotate them (see {@link verifyJwt}). */
    keys: JwtKey | readonly JwtKey[];
    // Authorization ヘッダーの代わりに、この名前の Cookie から読む
    /** Read the token from this cookie instead of the `Authorization: Bearer` header. */
    cookie?: string;
    /** The realm in the `WWW-Authenticate` header. Default: none. */
    realm?: string;
};

/**
 * Middleware that verifies the JWT of each request (from `Authorization: Bearer <token>`, or from a cookie) with
 * {@link verifyJwt}, and puts its payload in `c.get("jwtPayload")`. Without a token, or with one that is not accepted,
 * it answers 401 by throwing a {@link JwtError} (`app.onError` can change the body), with a `WWW-Authenticate: Bearer`
 * header (and `error="invalid_token"` when a token was sent).
 * Throws a `TypeError` when created without `algorithms` or keys.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { jwt, type JwtVariables } from "@senrijs/senri/jwt";
 *
 * const app = createApp<JwtVariables>();
 * app.use("/api", jwt({ keys: { kty: "RSA", n: "...", e: "AQAB", kid: "2026-11" }, algorithms: ["RS256"], issuer: "https://auth.example.com" }));
 * app.get("/api/me", (_, c) => c.get("jwtPayload"));
 * ```
 */
export function jwt(options: JwtOptions): Middleware {
    const algorithms = checkAlgorithms(options?.algorithms);
    // 短すぎる HMAC の秘密鍵は、最初のリクエストを待たずに、作るときに知らせる
    for (const entry of entriesOf(options.keys)) {
        if (typeof entry.key !== "string" || entry.key.startsWith("-----BEGIN")) continue;
        for (const alg of algorithms) {
            const spec = SPECS[alg];
            if (spec.name === "HMAC" && encoder.encode(entry.key).length < hashBytes(spec.hash)) {
                throw keyError(`the ${alg} secret must be at least ${hashBytes(spec.hash)} bytes (RFC 7518)`);
            }
        }
    }
    const realm = options.realm;
    if (realm !== undefined && !/^[\x20-\x7e]*$/.test(realm)) throw senriError("jwt_realm", new TypeError("jwt: invalid realm"));
    const quoted = realm === undefined ? "" : `realm="${realm.replace(/[\\"]/g, "\\$&")}"`;
    const missing = quoted === "" ? "Bearer" : `Bearer ${quoted}`;
    const invalid = quoted === "" ? 'Bearer error="invalid_token"' : `Bearer ${quoted}, error="invalid_token"`;

    return markPlainSafe<Middleware>(async function jwt(c, next) {
        const token = tokenOf(c, options.cookie);
        if (token === null) throw new JwtError("missing", missing);
        let payload: JwtPayload;
        try {
            payload = await verifyJwt(token, options.keys, options);
        } catch (err) {
            if (err instanceof JwtError) throw new JwtError(err.reason, invalid);
            throw err;
        }
        c.set("jwtPayload", payload);
        return next();
    });
}

function tokenOf(c: Context, cookie: string | undefined): string | null {
    if (cookie !== undefined) {
        const value = parseCookies(headerOf(c, "cookie"))[cookie];
        return value === undefined || value === "" ? null : value;
    }
    const authorization = headerOf(c, "authorization");
    const match = authorization === null ? null : /^Bearer +([^\s]+) *$/i.exec(authorization);
    return match ? match[1]! : null;
}
