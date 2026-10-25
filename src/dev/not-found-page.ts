// 開発モードの404ページ(HTML)を作る
import type { Context } from "../context.ts";
import { notFoundFallback } from "./fallback.ts";
import type { NotFoundPageData } from "./page-data.ts";
import { PAGE_HTML } from "./page.generated.ts";
import { renderPage } from "./render.ts";
import { explainDifference, suggest } from "./suggest.ts";

type RouteInfo = { method: string; path: string };

// ブラウザで開けるのは、パラメーターのない GET だけ(":id" に何を入れるかは分からないので)
const linkable = (r: RouteInfo) => r.method === "GET" && !r.path.includes(":");

export function notFoundPage(c: Context, routes: RouteInfo[]): Response {
    // notFound に来るのはパスをデコードできたリクエストだけなので、c.path は読める
    const path = c.path;
    const closest = suggest(routes, path);

    const data: NotFoundPageData = {
        kind: "notFound",
        method: c.req.method,
        path,
        suggestion: closest
            ? {
                  method: closest.method,
                  path: closest.path,
                  link: linkable(closest),
                  ...explainDifference(path, closest.path),
              }
            : null,
        // showRoutes と同じく、パスの順 → 同じパスならメソッドの順
        routes: [...routes]
            .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
            .map((r) => ({ method: r.method, path: r.path, link: linkable(r) })),
    };

    const body = c.req.method === "HEAD" ? null : renderPage(PAGE_HTML, data, notFoundFallback(data));
    return new Response(body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}
