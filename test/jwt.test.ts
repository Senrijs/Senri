import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { jwt, JwtError, signJwt, verifyJwt, type JwtAlgorithm, type JwtJwk, type JwtPayload, type JwtVariables } from "../src/jwt.ts";
import { explainText } from "../src/dev/explain.ts";

const SECRET = "a-secret-that-is-at-least-32-bytes-long!!";
const SECRET_64 = "x".repeat(64);
const b64url = (text: string) => Buffer.from(text).toString("base64url");

afterEach(() => setSystemTime());

async function rejects(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error("did not throw");
}

async function reason(promise: Promise<unknown>): Promise<string> {
    const err = await rejects(promise);
    if (!(err instanceof JwtError)) throw err;
    return err.reason;
}

// アルゴリズムごとの鍵の組(署名する鍵、確かめる鍵)
async function keyPair(alg: JwtAlgorithm): Promise<{ sign: CryptoKey | string; verify: CryptoKey | string }> {
    const hash = { "256": "SHA-256", "384": "SHA-384", "512": "SHA-512" }[alg.slice(2)]!;
    if (alg.startsWith("HS")) {
        const secret = alg === "HS256" ? SECRET : SECRET_64;
        return { sign: secret, verify: secret };
    }
    let params: RsaHashedKeyGenParams | EcKeyGenParams | Algorithm;
    if (alg.startsWith("RS")) params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash };
    else if (alg.startsWith("PS")) params = { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash };
    else if (alg === "ES256") params = { name: "ECDSA", namedCurve: "P-256" };
    else if (alg === "ES384") params = { name: "ECDSA", namedCurve: "P-384" };
    else params = { name: "Ed25519" };
    const pair = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
    return { sign: pair.privateKey, verify: pair.publicKey };
}

const ALGORITHMS: JwtAlgorithm[] = ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA", "Ed25519"];

async function pem(key: CryptoKey, label: "PUBLIC KEY" | "PRIVATE KEY"): Promise<string> {
    const der = Buffer.from(await crypto.subtle.exportKey(label === "PUBLIC KEY" ? "spki" : "pkcs8", key)).toString("base64");
    return `-----BEGIN ${label}-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
}

describe("signJwt() / verifyJwt()", () => {
    test.each(ALGORITHMS)("%s: 署名したものを確かめられる。1 バイトでも変えると通らない", async (alg) => {
        const keys = await keyPair(alg);
        const token = await signJwt({ sub: "42", role: "admin" }, keys.sign, { alg });
        const [header, payload, signature] = token.split(".");
        expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg, typ: "JWT" });
        expect(await verifyJwt(token, keys.verify, { algorithms: [alg] })).toMatchObject({ sub: "42", role: "admin" });

        const forged = b64url(JSON.stringify({ sub: "1", role: "admin", iat: 0 }));
        expect(await reason(verifyJwt(`${header}.${forged}.${signature}`, keys.verify, { algorithms: [alg] }))).toBe("signature");
        const flipped = signature!.slice(0, 5) + (signature![5] === "A" ? "B" : "A") + signature!.slice(6);
        expect(await reason(verifyJwt(`${header}.${payload}.${flipped}`, keys.verify, { algorithms: [alg] }))).toBe("signature");
    });

    test("iat を付け、expiresIn で exp を付ける", async () => {
        setSystemTime(new Date("2026-11-10T00:00:00Z"));
        const token = await signJwt({ sub: "1" }, SECRET, { alg: "HS256", expiresIn: 60 });
        const payload = await verifyJwt(token, SECRET, { algorithms: ["HS256"] });
        expect(payload).toEqual({ iat: 1794268800, sub: "1", exp: 1794268860 });
    });

    test("algorithms は必須。空・未対応・none は TypeError(code: jwt_algorithms)", async () => {
        const token = await signJwt({}, SECRET, { alg: "HS256" });
        for (const algorithms of [undefined, [], ["none"], ["HS256", "none"], ["toString"], "HS256"]) {
            const err = await rejects(verifyJwt(token, SECRET, { algorithms } as never));
            expect(err).toBeInstanceOf(TypeError);
            expect((err as { code?: string }).code).toBe("jwt_algorithms");
            expect(explainText(err, "ja")).toContain("algorithms");
        }
        expect(((await rejects(signJwt({}, SECRET, { alg: "none" } as never))) as { code?: string }).code).toBe("jwt_algorithms");
        expect(() => jwt({ keys: SECRET } as never)).toThrow(TypeError);
    });

    test('alg: "none" のトークンは、署名がなくてもあっても受け付けない', async () => {
        const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
        const payload = b64url(JSON.stringify({ sub: "admin" }));
        for (const token of [`${header}.${payload}.`, `${header}.${payload}.AAAA`]) {
            expect(await reason(verifyJwt(token, SECRET, { algorithms: ["HS256"] }))).toBe("algorithm");
        }
    });

    test("トークンの alg が algorithms になければ受け付けない", async () => {
        const token = await signJwt({}, SECRET_64, { alg: "HS512" });
        expect(await reason(verifyJwt(token, SECRET_64, { algorithms: ["HS256"] }))).toBe("algorithm");
    });

    test("取り違えの攻撃: RS256 の公開鍵(PEM)を HMAC の秘密鍵として使わせない", async () => {
        const keys = await keyPair("RS256");
        const publicPem = await pem(keys.verify as CryptoKey, "PUBLIC KEY");
        // 攻撃者は公開鍵を知っているので、それを秘密鍵にして HS256 で署名できる
        const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(publicPem), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const input = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: "admin" }))}`;
        const signature = Buffer.from(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(input))).toString("base64url");
        const token = `${input}.${signature}`;
        // 両方のアルゴリズムを受け付ける設定でも、PEM の文字列は HMAC の鍵にならない
        expect(await reason(verifyJwt(token, publicPem, { algorithms: ["RS256", "HS256"] }))).toBe("key");
        // 公開鍵の JWK や CryptoKey も同じ
        const jwk = await crypto.subtle.exportKey("jwk", keys.verify as CryptoKey);
        expect(await reason(verifyJwt(token, jwk, { algorithms: ["RS256", "HS256"] }))).toBe("key");
        expect(await reason(verifyJwt(token, keys.verify, { algorithms: ["RS256", "HS256"] }))).toBe("key");
    });

    test("HMAC の秘密鍵の文字列は、RS256 などの鍵にならない", async () => {
        const keys = await keyPair("RS256");
        const token = await signJwt({}, keys.sign, { alg: "RS256" });
        expect(await reason(verifyJwt(token, SECRET, { algorithms: ["RS256"] }))).toBe("key");
    });

    test("鍵の種類が alg と合わなければ使わない(RSA-PSS の鍵を RS256 に、P-384 の鍵を ES256 に)", async () => {
        const ps = await keyPair("PS256");
        const rsToken = await signJwt({}, (await keyPair("RS256")).sign, { alg: "RS256" });
        expect(await reason(verifyJwt(rsToken, ps.verify, { algorithms: ["RS256"] }))).toBe("key");
        const es384 = await keyPair("ES384");
        const es256Token = await signJwt({}, (await keyPair("ES256")).sign, { alg: "ES256" });
        expect(await reason(verifyJwt(es256Token, es384.verify, { algorithms: ["ES256"] }))).toBe("key");
    });

    test("HMAC の秘密鍵がハッシュより短ければ TypeError(code: jwt_key)", async () => {
        for (const [alg, secret] of [
            ["HS256", "short"],
            ["HS384", SECRET],
            ["HS512", SECRET],
        ] as const) {
            const err = await rejects(signJwt({}, secret, { alg }));
            expect((err as { code?: string }).code).toBe("jwt_key");
            expect(explainText(err, "ja")).toContain("32 バイト以上");
        }
        expect(() => jwt({ keys: "short", algorithms: ["HS256"] })).toThrow(TypeError);
    });

    test("公開鍵では署名できない(TypeError)", async () => {
        const keys = await keyPair("ES256");
        expect(((await rejects(signJwt({}, keys.verify, { alg: "ES256" }))) as { code?: string }).code).toBe("jwt_key");
    });

    test("PEM(PUBLIC KEY / PRIVATE KEY)と JWK の鍵が使える", async () => {
        for (const alg of ["RS256", "PS384", "ES256", "EdDSA", "Ed25519"] as const) {
            const keys = await keyPair(alg);
            const privatePem = await pem(keys.sign as CryptoKey, "PRIVATE KEY");
            const publicPem = await pem(keys.verify as CryptoKey, "PUBLIC KEY");
            const privateJwk = (await crypto.subtle.exportKey("jwk", keys.sign as CryptoKey)) as JwtJwk;
            const publicJwk = (await crypto.subtle.exportKey("jwk", keys.verify as CryptoKey)) as JwtJwk;
            const token = await signJwt({ sub: alg }, privatePem, { alg });
            expect((await verifyJwt(token, publicPem, { algorithms: [alg] })).sub).toBe(alg);
            expect((await verifyJwt(token, publicJwk, { algorithms: [alg] })).sub).toBe(alg);
            // 秘密鍵の JWK を渡されても、公開鍵の部分で確かめる
            expect((await verifyJwt(token, privateJwk, { algorithms: [alg] })).sub).toBe(alg);
            const fromJwk = await signJwt({ sub: alg }, privateJwk, { alg });
            expect((await verifyJwt(fromJwk, publicPem, { algorithms: [alg] })).sub).toBe(alg);
        }
        const oct: JwtJwk = { kty: "oct", k: Buffer.from(SECRET).toString("base64url") };
        expect((await verifyJwt(await signJwt({ sub: "oct" }, oct, { alg: "HS256" }), SECRET, { algorithms: ["HS256"] })).sub).toBe("oct");
    });

    test("JWK の alg・use が合わなければ使わない", async () => {
        const keys = await keyPair("RS256");
        const jwk = (await crypto.subtle.exportKey("jwk", keys.verify as CryptoKey)) as JwtJwk;
        const token = await signJwt({}, keys.sign, { alg: "RS256" });
        expect(await reason(verifyJwt(token, { ...jwk, alg: "RS512" }, { algorithms: ["RS256"] }))).toBe("key");
        expect(await reason(verifyJwt(token, { ...jwk, use: "enc" }, { algorithms: ["RS256"] }))).toBe("key");
        expect(await verifyJwt(token, { ...jwk, alg: "RS256", use: "sig" }, { algorithms: ["RS256"] })).toBeDefined();
    });

    test("PKCS #1 の PEM(RSA PUBLIC KEY)は TypeError で、変換を案内する", async () => {
        const token = await signJwt({}, (await keyPair("RS256")).sign, { alg: "RS256" });
        const err = await rejects(verifyJwt(token, "-----BEGIN RSA PUBLIC KEY-----\nAAAA\n-----END RSA PUBLIC KEY-----", { algorithms: ["RS256"] }));
        expect((err as { code?: string; message: string }).message).toContain("PUBLIC KEY");
    });
});

describe("鍵の入れ替え", () => {
    test("鍵の配列: どれで署名したものも通る", async () => {
        const old = "old-secret-that-is-at-least-32-bytes-long";
        const token = await signJwt({ sub: "1" }, old, { alg: "HS256" });
        expect((await verifyJwt(token, [SECRET, old], { algorithms: ["HS256"] })).sub).toBe("1");
        expect(await reason(verifyJwt(token, [SECRET], { algorithms: ["HS256"] }))).toBe("signature");
    });

    test("kid: { kid, key } で署名すると header に kid が入り、その kid の鍵だけで確かめる", async () => {
        const keys = [
            { kid: "2026-11", key: SECRET },
            { kid: "2026-10", key: "old-secret-that-is-at-least-32-bytes-long" },
        ];
        const token = await signJwt({ sub: "1" }, keys[1]!, { alg: "HS256" });
        expect(JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).kid).toBe("2026-10");
        expect((await verifyJwt(token, keys, { algorithms: ["HS256"] })).sub).toBe("1");
        // 同じ秘密鍵でも、kid が違う鍵では確かめない
        expect(await reason(verifyJwt(token, [{ kid: "other", key: keys[1]!.key }], { algorithms: ["HS256"] }))).toBe("key");
    });

    test("kid のない鍵は、どの kid のトークンにも試す", async () => {
        const token = await signJwt({}, SECRET, { alg: "HS256", kid: "any" });
        expect(await verifyJwt(token, SECRET, { algorithms: ["HS256"] })).toBeDefined();
    });

    test("JWK の kid を使う(JWKS の keys をそのまま渡せる)", async () => {
        const a = await keyPair("ES256");
        const b = await keyPair("ES256");
        const jwks = [
            { ...((await crypto.subtle.exportKey("jwk", a.verify as CryptoKey)) as JwtJwk), kid: "a" },
            { ...((await crypto.subtle.exportKey("jwk", b.verify as CryptoKey)) as JwtJwk), kid: "b" },
        ];
        const token = await signJwt({ sub: "b" }, { kid: "b", key: b.sign }, { alg: "ES256" });
        expect((await verifyJwt(token, jwks, { algorithms: ["ES256"] })).sub).toBe("b");
        // kid を a にすり替えると、a の鍵で確かめて通らない
        const [header, payload, signature] = token.split(".");
        const swapped = b64url(JSON.stringify({ ...JSON.parse(Buffer.from(header!, "base64url").toString()), kid: "a" }));
        expect(await reason(verifyJwt(`${swapped}.${payload}.${signature}`, jwks, { algorithms: ["ES256"] }))).toBe("signature");
    });
});

describe("クレーム", () => {
    async function at(time: string, payload: Record<string, unknown>, options: object = {}) {
        setSystemTime(new Date("2026-11-10T00:00:00Z"));
        const token = await signJwt(payload as JwtPayload, SECRET, { alg: "HS256" });
        setSystemTime(new Date(time));
        return verifyJwt(token, SECRET, { algorithms: ["HS256"], ...options });
    }
    const T = 1794268800; // 2026-11-10T00:00:00Z

    test("exp: その時刻ちょうどから期限切れ。clockTolerance で許す", async () => {
        expect(await at("2026-11-10T00:00:59Z", { exp: T + 60 })).toBeDefined();
        expect(await reason(at("2026-11-10T00:01:00Z", { exp: T + 60 }))).toBe("expired");
        expect(await at("2026-11-10T00:01:00Z", { exp: T + 60 }, { clockTolerance: 5 })).toBeDefined();
    });

    test("nbf: その時刻より前は通らない", async () => {
        expect(await reason(at("2026-11-10T00:00:00Z", { nbf: T + 10 }))).toBe("not_before");
        expect(await at("2026-11-10T00:00:10Z", { nbf: T + 10 })).toBeDefined();
    });

    test("maxAge: iat から古すぎるもの、iat のないものは通らない", async () => {
        expect(await reason(at("2026-11-10T01:00:01Z", {}, { maxAge: 3600 }))).toBe("max_age");
        expect(await at("2026-11-10T01:00:00Z", {}, { maxAge: 3600 })).toBeDefined();
        expect(await reason(at("2026-11-10T00:00:00Z", { iat: undefined }, { maxAge: 3600 }))).toBe("max_age");
    });

    test("issuer・audience・subject", async () => {
        const now = "2026-11-10T00:00:00Z";
        expect(await at(now, { iss: "a" }, { issuer: ["a", "b"] })).toBeDefined();
        expect(await reason(at(now, { iss: "c" }, { issuer: "a" }))).toBe("issuer");
        expect(await reason(at(now, {}, { issuer: "a" }))).toBe("issuer");
        expect(await at(now, { aud: ["x", "y"] }, { audience: "y" })).toBeDefined();
        expect(await reason(at(now, { aud: "z" }, { audience: ["x", "y"] }))).toBe("audience");
        expect(await reason(at(now, {}, { audience: "x" }))).toBe("audience");
        expect(await reason(at(now, { sub: "1" }, { subject: "2" }))).toBe("subject");
    });

    test("型の違うクレームは claim", async () => {
        const now = "2026-11-10T00:00:00Z";
        for (const payload of [{ exp: "tomorrow" }, { nbf: null }, { iat: "x" }, { iss: 1 }, { aud: [1] }, { sub: {} }]) {
            expect(await reason(at(now, payload))).toBe("claim");
        }
    });
});

describe("形のおかしいトークン", () => {
    test("malformed になる", async () => {
        const good = await signJwt({}, SECRET, { alg: "HS256" });
        const [h, p, s] = good.split(".");
        const tokens = [
            "",
            "a.b",
            `${h}.${p}.${s}.x`,
            `${h}.${p}.${s}=`,
            `${h}.${p}.${s}+`,
            `${b64url("not json")}.${p}.${s}`,
            `${b64url("[1]")}.${p}.${s}`,
            `${h}.${b64url("null")}.${s}`,
            `${b64url(JSON.stringify({ alg: "HS256", crit: ["exp"] }))}.${p}.${s}`,
            `${b64url(JSON.stringify({ alg: "HS256", kid: 1 }))}.${p}.${s}`,
            "a".repeat(20_000),
        ];
        for (const token of tokens) {
            expect(await reason(verifyJwt(token, SECRET, { algorithms: ["HS256"] }))).toBe("malformed");
        }
    });

    test("署名の base64url の、使われないビットを変えても通らない", async () => {
        const token = await signJwt({}, SECRET, { alg: "HS256" });
        const last = token.at(-1)!;
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        const other = alphabet[alphabet.indexOf(last) + 1]!;
        expect(await reason(verifyJwt(token.slice(0, -1) + other, SECRET, { algorithms: ["HS256"] }))).toBe("malformed");
    });

    test("JwtError は 401 の HttpError で、WWW-Authenticate が付く", async () => {
        const err = (await rejects(verifyJwt("x", SECRET, { algorithms: ["HS256"] }))) as JwtError;
        expect([err.status, err.headers.get("www-authenticate"), err.message]).toEqual([401, 'Bearer error="invalid_token"', "401 Unauthorized: malformed token"]);
    });
});

describe("jwt() ミドルウェア", () => {
    function makeApp(options: Partial<Parameters<typeof jwt>[0]> = {}) {
        const app = createApp<JwtVariables<{ sub: string }>>();
        app.use("/api", jwt({ keys: SECRET, algorithms: ["HS256"], ...options }));
        app.get("/api/me", (_, c) => ({ sub: c.get("jwtPayload")?.sub }));
        app.get("/public", () => "public");
        return app;
    }
    const get = (app: ReturnType<typeof makeApp>, path: string, headers: Record<string, string> = {}) =>
        app.fetch(new Request(`http://localhost${path}`, { headers }));

    test("Bearer のトークンを確かめて、c.get(\"jwtPayload\") に入れる", async () => {
        const token = await signJwt({ sub: "42" }, SECRET, { alg: "HS256" });
        const res = await get(makeApp(), "/api/me", { authorization: `Bearer ${token}` });
        expect([res.status, await res.json()]).toEqual([200, { sub: "42" }]);
        // スキームの大文字小文字は区別しない
        expect((await get(makeApp(), "/api/me", { authorization: `bearer ${token}` })).status).toBe(200);
        expect((await get(makeApp(), "/public")).status).toBe(200);
    });

    test("トークンがなければ 401 と WWW-Authenticate: Bearer(error なし)", async () => {
        for (const headers of [{}, { authorization: "Basic abc" }, { authorization: "Bearer" }] as Record<string, string>[]) {
            const res = await get(makeApp({ realm: "api" }), "/api/me", headers);
            expect([res.status, res.headers.get("www-authenticate")]).toEqual([401, 'Bearer realm="api"']);
        }
    });

    test("だめなトークンは 401 と error=\"invalid_token\"", async () => {
        const expired = await signJwt({ sub: "1", exp: 1 }, SECRET, { alg: "HS256" });
        const res = await get(makeApp(), "/api/me", { authorization: `Bearer ${expired}` });
        expect([res.status, res.headers.get("www-authenticate"), await res.text()]).toEqual([
            401,
            'Bearer error="invalid_token"',
            "401 Unauthorized: token expired",
        ]);
    });

    test("cookie: Cookie からトークンを読む", async () => {
        const token = await signJwt({ sub: "7" }, SECRET, { alg: "HS256" });
        const app = makeApp({ cookie: "session" });
        expect(await (await get(app, "/api/me", { cookie: `session=${token}` })).json()).toEqual({ sub: "7" });
        expect((await get(app, "/api/me", { authorization: `Bearer ${token}` })).status).toBe(401);
    });

    test("JwtError なので、app.onError で本文を変えられる(WWW-Authenticate は残る)", async () => {
        const app = makeApp();
        app.onError((err, c) => c.json({ error: err instanceof JwtError ? err.reason : "unknown" }));
        const res = await get(app, "/api/me", { authorization: "Bearer x.y.z" });
        expect(res.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
        expect([res.status, await res.json()]).toEqual([401, { error: "malformed" }]);
    });
});
