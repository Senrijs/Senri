// ルーターだけを比べるベンチマーク(Request も Response も作らない)
// 「メソッドとパスの文字列から、ハンドラーとパラメーターを見つける」ところまで
// 使い方: cd bench && bun install && bun run router
import { bench, group, run, summary } from "mitata";
import { RegExpRouter } from "hono/router/reg-exp-router";
import { TrieRouter } from "hono/router/trie-router";
import Memoirist from "memoirist";
import { createMatcher } from "../src/matcher.ts";
import { splitPath, splitPattern, type Route } from "../src/router.ts";
import { REQUESTS, ROUTES } from "./apps.ts";

type Find = (method: string, path: string) => unknown;

// Senri がリクエストごとにやっていることと同じ: パラメーターのないルートは Map で引き、
// なければパスを分割して Trie をたどる(src/app.ts の resolve)
function senri(): Find {
    const matcher = createMatcher();
    for (const [method, path] of ROUTES) {
        const segments = splitPattern(path);
        const paramNames = segments.filter((s) => s.startsWith(":")).map((s) => s.slice(1));
        const route: Route = { path, segments, paramNames, method, handler: () => path };
        matcher.add(route);
    }
    return (method, path) => {
        const exact = matcher.staticLeaf(path);
        if (exact) {
            for (const route of exact) if (route.method === method) return route;
        }
        const hit = matcher.first(splitPath(path), method);
        if (!hit) return null;
        const params: Record<string, string> = {};
        hit.route.paramNames.forEach((name, i) => (params[name] = hit.values[i]!));
        return [hit.route, params];
    };
}

// Hono の既定(SmartRouter)は、このルート一式なら RegExpRouter を選ぶ
function honoRegExp(): Find {
    const router = new RegExpRouter<string>();
    for (const [method, path] of ROUTES) router.add(method, path, path);
    return (method, path) => router.match(method, path);
}

function honoTrie(): Find {
    const router = new TrieRouter<string>();
    for (const [method, path] of ROUTES) router.add(method, path, path);
    return (method, path) => router.match(method, path);
}

// Elysia が使っているルーター
function memoirist(): Find {
    const router = new Memoirist<string>();
    for (const [method, path] of ROUTES) router.add(method, path, path);
    return (method, path) => router.find(method, path);
}

const ROUTERS: [string, Find][] = [
    ["senri", senri()],
    ["hono (RegExpRouter)", honoRegExp()],
    ["hono (TrieRouter)", honoTrie()],
    ["memoirist (Elysia)", memoirist()],
];

for (const [name, method, path] of REQUESTS) {
    summary(() => {
        group(name, () => {
            for (const [router, find] of ROUTERS) bench(router, () => find(method, path));
        });
    });
}

await run();
