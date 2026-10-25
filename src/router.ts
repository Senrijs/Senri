import type { Handler } from "./context.ts";
import { HttpError } from "./errors.ts";

export type Route = {
    path: string;
    // path を "/" で分割したもの(登録時に1回だけ作る)
    segments: string[];
    method: string;
    handler: Handler;
};

export type ExtractParams<Path extends string> =
    Path extends `${string}:${infer Param}/${infer Rest}`
        ? { [K in Param]: string } & ExtractParams<`${Rest}`>
        : Path extends `${string}:${infer Param}`
            ? { [K in Param]: string }
            : {};

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

// ルートのパターン("/users/:id")を分割する。末尾スラッシュや連続スラッシュは無視
export function splitPattern(pattern: string): string[] {
    return pattern.split("/").filter(Boolean);
}

// リクエストのパス(URL の pathname)を分割して、セグメントごとにデコードする
// - 末尾スラッシュや連続スラッシュは無視する("/a//b/" は "/a/b" と同じ)
// - "/" ごとに分割してからデコードするので、%2F が区切りと混ざることはないが、
//   紛らわしいので %2F(デコードすると "/" を含む)は 400 にする
// - デコードすると "." や ".." になるものは、パストラバーサルの元なので 400 にする
//   (ふつうは "%2E%2E" も含めて URL の仕様で解決済みなので、ここは念のための防御)
export function splitPath(pathname: string): string[] {
    const segments: string[] = [];
    for (const raw of pathname.split("/")) {
        if (raw === "") continue;

        let segment: string;
        try {
            segment = decodeURIComponent(raw);
        } catch {
            throw new HttpError(400, "400 Bad Request");
        }
        if (segment.includes("/") || segment === "." || segment === "..") {
            throw new HttpError(400, "400 Bad Request");
        }
        segments.push(segment);
    }
    return segments;
}

export function matchPath(pattern: readonly string[], path: readonly string[]): Record<string, string> | null {
    // 個数が違ったら一致しない
    if (pattern.length !== path.length) {
        return null;
    }

    // 1個ずつ比較する
    const params: Record<string, string> = {};

    for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i]!;
        const actual = path[i]!;

        if (p.startsWith(":")) {
            params[p.slice(1)] = actual;
        } else if (p !== actual) {
            return null;
        }
    }

    return params;
}

// Allow ヘッダーに入れるメソッドの一覧("GET, HEAD, POST, OPTIONS")
// GET があれば HEAD も使える(GET にフォールバックするので)。OPTIONS はいつでも使える
export function allowedMethods(routes: readonly Route[]): string {
    const methods: string[] = [];
    for (const r of routes) {
        if (!methods.includes(r.method)) methods.push(r.method);
        if (r.method === "GET" && !methods.includes("HEAD")) methods.push("HEAD");
    }
    if (!methods.includes("OPTIONS")) methods.push("OPTIONS");
    return methods.join(", ");
}

// path の先頭が prefix と一致するか。セグメント単位で比べるので "/admin" は "/administrator" にはマッチしない
export function startsWithSegments(path: readonly string[], prefix: readonly string[]): boolean {
    if (path.length < prefix.length) return false;
    return prefix.every((p, i) => p === path[i]);
}

// sort 用の比較関数。どの2つを比べても答えが矛盾しない(=並び順が一意に決まる)ようにする
export function compareRoutes(a: Route, b: Route): number {
    const aParts = a.segments;
    const bParts = b.segments;

    // まずセグメント数で分ける。数が違うルート同士はそもそも同じパスにマッチしないので、
    // ここで順番を決めてしまっても優先順位には影響しない
    // (以前はここで 0 = 「同じ」と答えていたため、sort の結果が登録順に左右されていた)
    if (aParts.length !== bParts.length) {
        return aParts.length - bParts.length;
    }

    for (let i = 0; i < aParts.length; i++) {
        const aIsParam = aParts[i]!.startsWith(":");
        const bIsParam = bParts[i]!.startsWith(":");

        // aがパラメータでbがパラメータでない場合、bを優先する
        if (aIsParam && !bIsParam) return 1;
        // aがパラメータでなくbがパラメータの場合、aを優先する
        if (!aIsParam && bIsParam) return -1;
    }
    return 0;
}
