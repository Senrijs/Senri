// JWT のすべてのアルゴリズムが、このランタイムの Web Crypto で動くかを確かめる(smoke とブラウザのテストが使う)
// 鍵を作り、署名して、確かめて、書き換えたものが通らないことまで見る。通ったアルゴリズムの名前を返す
import { signJwt, verifyJwt, type JwtAlgorithm } from "../../src/jwt.ts";

export const JWT_ALGORITHMS: JwtAlgorithm[] = [
    "HS256",
    "HS384",
    "HS512",
    "RS256",
    "RS384",
    "RS512",
    "PS256",
    "PS384",
    "PS512",
    "ES256",
    "ES384",
    "EdDSA",
    "Ed25519",
];

async function keysFor(alg: JwtAlgorithm): Promise<{ sign: string | CryptoKey; verify: string | CryptoKey }> {
    if (alg.startsWith("HS")) return { sign: "s".repeat(64), verify: "s".repeat(64) };
    const hash = `SHA-${alg.slice(2)}`;
    const rsa = { modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash };
    const params = alg.startsWith("RS")
        ? { name: "RSASSA-PKCS1-v1_5", ...rsa }
        : alg.startsWith("PS")
          ? { name: "RSA-PSS", ...rsa }
          : alg === "ES256"
            ? { name: "ECDSA", namedCurve: "P-256" }
            : alg === "ES384"
              ? { name: "ECDSA", namedCurve: "P-384" }
              : { name: "Ed25519" };
    const pair = (await crypto.subtle.generateKey(params, false, ["sign", "verify"])) as CryptoKeyPair;
    return { sign: pair.privateKey, verify: pair.publicKey };
}

export async function checkJwtAlgorithms(): Promise<string[]> {
    const passed: string[] = [];
    for (const alg of JWT_ALGORITHMS) {
        try {
            const keys = await keysFor(alg);
            const token = await signJwt({ sub: alg }, keys.sign, { alg, expiresIn: 60 });
            const payload = await verifyJwt(token, keys.verify, { algorithms: [alg] });
            const [header, , signature] = token.split(".");
            const forged = `${header}.${btoa(JSON.stringify({ sub: "x" })).replace(/=+$/, "")}.${signature}`;
            const rejected = await verifyJwt(forged, keys.verify, { algorithms: [alg] }).then(
                () => false,
                () => true,
            );
            if (payload.sub === alg && rejected) passed.push(alg);
        } catch {
            // 動かないアルゴリズムは、名前を返さない
        }
    }
    return passed;
}
