// 開発モードの404ページ(HTML)を作る
import type { Context } from "../context.ts";
import type { Lang } from "../lang.ts";
import { dashboardLinkOf } from "./dashboard/links.ts";
import { notFoundFallback } from "./fallback.ts";
import type { NotFoundPageData } from "./page-data.ts";
import { PAGE_HTML } from "./page.generated.ts";
import { renderPage } from "./render.ts";
import { explainDifference, suggest } from "./suggest.ts";

type RouteInfo = { method: string; path: string };

// ブラウザで開けるのは、パラメーターのない GET(と、どのメソッドでも動く all)だけ
// (":id" や "*" に何を入れるかは分からないので、それらのあるものはリンクにしない)
const linkable = (r: RouteInfo) => (r.method === "GET" || r.method === "ALL") && !r.path.includes(":") && !r.path.endsWith("*");

export function notFoundPage(c: Context, routes: RouteInfo[], lang: Lang): Response {
    // devNotFound が先に確かめているので、c.path は読める
    const path = c.path;
    // ルートがあるのに c.notFound() を呼んだときは、提案しない(c.route はミドルウェアより先に決まる)
    const closest = c.route === undefined ? suggest(routes, path) : null;

    const data: NotFoundPageData = {
        kind: "notFound",
        lang,
        method: c.req.method,
        path,
        suggestion: closest
            ? {
                  method: closest.method,
                  path: closest.path,
                  link: linkable(closest),
                  ...explainDifference(path, closest.path, lang),
              }
            : null,
        // showRoutes と同じく、パスの順 → 同じパスならメソッドの順
        routes: [...routes]
            .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
            .map((r) => ({ method: r.method, path: r.path, link: linkable(r) })),
        dashboardUrl: dashboardLinkOf(c),
    };

    const body = c.req.method === "HEAD" ? null : renderPage(PAGE_HTML, data, notFoundFallback(data));
    return new Response(body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}
