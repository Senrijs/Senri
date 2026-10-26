import { describe, expect, test } from "bun:test";
import { createMatcher } from "../src/matcher.ts";
import { compareRoutes, matchPath, splitPattern, type Route } from "../src/router.ts";

// 以前のやり方(全部のルートを優先順位で並べて、前から順に試す)。これと同じ順番になることを確かめる
function oracle(routes: Route[], segments: string[]) {
    return [...routes]
        .sort(compareRoutes)
        .map((route) => ({ route, params: matchPath(route.segments, segments) }))
        .filter((x): x is { route: Route; params: Record<string, string> } => x.params !== null);
}

function route(method: string, path: string): Route {
    const segments = splitPattern(path);
    return {
        path,
        segments,
        paramNames: segments.filter((s) => s.startsWith(":")).map((s) => s.slice(1)),
        method,
        handler: () => "",
    };
}

function paramsOf(route: Route, values: string[]) {
    return Object.fromEntries(route.paramNames.map((name, i) => [name, values[i]!]));
}

function viaMatcher(routes: Route[], segments: string[]) {
    const matcher = createMatcher();
    for (const r of routes) matcher.add(r);
    return matcher.match(segments).flatMap(({ leaf, values }) =>
        leaf.map((r) => ({
            route: r,
            params: Object.fromEntries(r.paramNames.map((name, i) => [name, values[i]!])),
        })),
    );
}

// 決まった乱数(毎回同じ並びになるように)
function random(seed: number) {
    return () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
}

describe("matcher(Trie)", () => {
    test("静的なセグメントが先、だめならパラメーターに戻る(バックトラック)", () => {
        const routes = [route("GET", "/users/:id/posts"), route("GET", "/users/me/likes"), route("GET", "/users/me")];
        const m = viaMatcher(routes, ["users", "me", "posts"]);
        expect(m.map((x) => x.route.path)).toEqual(["/users/:id/posts"]);
        expect(m[0]!.params).toEqual({ id: "me" });
    });

    test("パラメーターのないルートは Map で引ける", () => {
        const matcher = createMatcher();
        const r = route("GET", "/a/b");
        matcher.add(r);
        matcher.add(route("GET", "/a/:x"));
        expect(matcher.staticLeaf("/a/b")).toEqual([r]);
        expect(matcher.staticLeaf("/a/c")).toBeUndefined();
    });

    test("ランダムなルートとパスで、以前のやり方と同じ順番・同じパラメーターになる", () => {
        const rand = random(42);
        const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
        const words = ["a", "b", "c", "me"];
        const methods = ["GET", "POST", "ALL"];

        for (let round = 0; round < 300; round++) {
            // 形とメソッドが重ならないルートを作る(アプリでは重なると登録時にエラーになる)
            const routes: Route[] = [];
            const seen = new Set<string>();
            for (let i = 0; i < 12; i++) {
                const length = 1 + Math.floor(rand() * 3);
                const segments = Array.from({ length }, (_, j) => (rand() < 0.4 ? `:p${j}${pick(words)}` : pick(words)));
                const method = pick(methods);
                const shape = method + " " + segments.map((s) => (s.startsWith(":") ? ":" : s)).join("/");
                if (seen.has(shape)) continue;
                seen.add(shape);
                routes.push(route(method, "/" + segments.join("/")));
            }
            for (let k = 0; k < 10; k++) {
                const path = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(words));
                const expected = oracle(routes, path).map((x) => [x.route.method, x.route.path, x.params]);
                const actual = viaMatcher(routes, path).map((x) => [x.route.method, x.route.path, x.params]);
                // 同じ形(同じ葉)の中の順番は登録順。以前のやり方も安定ソートなので登録順になる
                expect(actual).toEqual(expected);

                // first(): メソッドが合う最初のもの = 以前のやり方で、前から探して最初にメソッドが合ったもの
                const matcher = createMatcher();
                for (const r of routes) matcher.add(r);
                for (const method of methods) {
                    const want = oracle(routes, path).find((x) => x.route.method === method);
                    const got = matcher.first(path, method);
                    expect(got && [got.route.path, paramsOf(got.route, got.values)]).toEqual(
                        want ? [want.route.path, want.params] : null,
                    );
                }
            }
        }
    });
});
