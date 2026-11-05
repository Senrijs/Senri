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

// match() は 405 と自動の OPTIONS を決めるためのものなので、ワイルドカードのルートを含まない
const withoutWild = <T extends { route: Route }>(list: T[]) => list.filter((x) => x.route.segments.at(-1) !== "*");

function route(method: string, path: string): Route {
    const segments = splitPattern(path);
    return {
        path,
        segments,
        paramNames: segments.filter((s) => s.startsWith(":") || s === "*").map((s) => (s === "*" ? s : s.slice(1))),
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

    test("ワイルドカードは Map に入らず、静的 → パラメーター → ワイルドカードの順に当たる", () => {
        const matcher = createMatcher();
        const wild = route("GET", "/a/*");
        const param = route("GET", "/a/:x");
        const exact = route("GET", "/a/b");
        for (const r of [wild, param, exact]) matcher.add(r);

        expect(matcher.staticLeaf("/a/*")).toBeUndefined();
        expect(matcher.first(["a", "b"], "GET")).toEqual({ route: exact, values: [] });
        expect(matcher.first(["a", "c"], "GET")).toEqual({ route: param, values: ["c"] });
        expect(matcher.first(["a", "c", "d"], "GET")).toEqual({ route: wild, values: ["c/d"] });
        expect(matcher.first(["a"], "GET")).toEqual({ route: wild, values: [""] });
        expect(matcher.first(["a"], "POST")).toBeNull();
    });

    test("match() はワイルドカードのルートを返さない", () => {
        const matcher = createMatcher();
        const exact = route("POST", "/a/b");
        matcher.add(route("GET", "/a/*"));
        matcher.add(exact);

        expect(matcher.match(["a", "b"]).flatMap((m) => m.leaf)).toEqual([exact]);
        expect(matcher.match(["a", "c"])).toEqual([]);
    });

    test("ランダムなルートとパスで、以前のやり方と同じ順番・同じパラメーターになる", () => {
        const rand = random(42);
        const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
        const words = ["a", "b", "c", "me"];
        const methods = ["GET", "POST", "ALL"];
        let wildHits = 0;

        for (let round = 0; round < 300; round++) {
            // 形とメソッドが重ならないルートを作る(アプリでは重なると登録時にエラーになる)
            const routes: Route[] = [];
            const seen = new Set<string>();
            for (let i = 0; i < 12; i++) {
                const length = 1 + Math.floor(rand() * 3);
                const segments = Array.from({ length }, (_, j) => (rand() < 0.4 ? `:p${j}${pick(words)}` : pick(words)));
                if (rand() < 0.3) segments[length - 1] = "*";
                const method = pick(methods);
                const shape = method + " " + segments.map((s) => (s.startsWith(":") ? ":" : s)).join("/");
                if (seen.has(shape)) continue;
                seen.add(shape);
                routes.push(route(method, "/" + segments.join("/")));
            }
            for (let k = 0; k < 10; k++) {
                const path = Array.from({ length: Math.floor(rand() * 5) }, () => pick(words));
                const all = oracle(routes, path);
                wildHits += all.length - withoutWild(all).length;
                const expected = withoutWild(all).map((x) => [x.route.method, x.route.path, x.params]);
                const actual = viaMatcher(routes, path).map((x) => [x.route.method, x.route.path, x.params]);
                // 同じ形(同じ葉)の中の順番は登録順。以前のやり方も安定ソートなので登録順になる
                expect(actual).toEqual(expected);

                // first(): メソッドが合う最初のもの = 以前のやり方で、前から探して最初にメソッドが合ったもの
                const matcher = createMatcher();
                for (const r of routes) matcher.add(r);
                for (const method of methods) {
                    const want = all.find((x) => x.route.method === method);
                    const got = matcher.first(path, method);
                    expect(got && [got.route.path, paramsOf(got.route, got.values)]).toEqual(
                        want ? [want.route.path, want.params] : null,
                    );
                }
            }
        }
        // ワイルドカードに当たる場合を、ちゃんと試している
        expect(wildHits).toBeGreaterThan(1000);
    });
});
