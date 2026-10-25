import type { Handler } from "./context.ts";

export type Route = {
    path: string;
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

export function matchPath(pattern: string, path: string): Record<string, string> | null {
    // 1. "/"で分割する
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);

    // 2. 個数が違ったら一致しない
    if (patternParts.length !== pathParts.length) {
        return null;
    }

    // 3. 1個ずつ比較する
    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i]!;
        const actual = pathParts[i]!;

        if (p.startsWith(":")) {
            params[p.slice(1)] = actual;
        } else if (p !== actual) {
            return null;
        }
    }

    return params;
}

// sort 用の比較関数。どの2つを比べても答えが矛盾しない(=並び順が一意に決まる)ようにする
export function compareRoutes(a: Route, b: Route): number {
    const aParts = a.path.split("/").filter(Boolean);
    const bParts = b.path.split("/").filter(Boolean);

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
