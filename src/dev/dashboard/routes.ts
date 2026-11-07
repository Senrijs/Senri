// /_senri 以下へのリクエストを処理する(ページ、JSON の API、SSE、クリア)
// 利用者のミドルウェアは通さず、記録もしない(app.ts が先にここへ回す)
import type { Lang } from "../../lang.ts";
import { splitPattern } from "../../router.ts";
import { errorFallback } from "../fallback.ts";
import type { DashboardPageData, MiddlewareRow, RequestSummary, RouteRow } from "../page-data.ts";
import { PAGE_HTML } from "../page.generated.ts";
import { renderPage } from "../render.ts";
import { applies, routeWarnings } from "../route-warnings.ts";
import { sameOrigin } from "./access.ts";
import type { Dashboard } from "./index.ts";
import type { DashboardRecord } from "./record.ts";

const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

const html = (body: string) =>
    new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const notFound = () => json({ error: "not found" }, 404);

export function summarize(r: DashboardRecord): RequestSummary {
    return {
        id: r.id,
        time: r.time,
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        hasError: r.error !== null,
    };
}

function routeRows(d: Dashboard): RouteRow[] {
    const middlewares = d.source.middlewares();
    return d.source.routes().map((r) => {
        const segments = splitPattern(r.path);
        return {
            method: r.method,
            path: r.path,
            middlewares: middlewares.map((m) => ({
                name: m.name,
                applies: applies(m.path === null ? null : splitPattern(m.path), segments),
            })),
        };
    });
}

function middlewareRows(d: Dashboard): MiddlewareRow[] {
    const records = d.log.list();
    return d.source.middlewares().map((m, i) => {
        // 名前ではなく登録順(order)で数える(同じ名前のミドルウェアが2つあっても、別々に集計される)
        const order = i + 1;
        const selfs = records.flatMap((r) => r.layers.filter((l) => l.order === order && l.state !== "skipped").map((l) => l.self));
        return {
            order,
            name: m.name,
            anonymous: m.anonymous,
            path: m.path,
            runs: selfs.length,
            avgSelfMs: selfs.length === 0 ? null : selfs.reduce((a, b) => a + b, 0) / selfs.length,
        };
    });
}

export function pageData(d: Dashboard, lang: Lang): DashboardPageData {
    return {
        kind: "dashboard",
        lang,
        max: d.log.max,
        requests: d.log.list().map(summarize),
        routes: routeRows(d),
        middlewares: middlewareRows(d),
        warnings: routeWarnings(d.source.routes(), d.source.middlewares(), lang),
    };
}

// segments: c.segments の "_senri" より後ろ(["api", "requests", "12"] など)
export async function handleDashboard(
    d: Dashboard,
    req: Request,
    segments: readonly string[],
    events: (req: Request) => Response,
): Promise<Response> {
    const [first, second, id, sub] = segments;
    const method = req.method;

    // ページ本体
    if (segments.length === 0) {
        return method === "GET" || method === "HEAD" ? html(renderPage(PAGE_HTML, pageData(d, d.lang(req)))) : notFound();
    }
    if (first !== "api") return notFound();

    if (second === "clear" && segments.length === 2) {
        if (method !== "POST") return notFound();
        // ほかのサイトのページから、こっそり POST させられないように
        if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
        d.log.clear();
        return new Response(null, { status: 204 });
    }

    if (method !== "GET") return notFound();

    if (second === "events" && segments.length === 2) return events(req);
    if (second === "routes" && segments.length === 2) return json(routeRows(d));
    if (second === "middleware" && segments.length === 2) return json(middlewareRows(d));

    if (second === "requests") {
        if (segments.length === 2) return json(d.log.list().map(summarize));
        const record = id === undefined ? undefined : d.log.get(id);
        if (!record) return notFound();
        if (segments.length === 3) return json(record);
        // 500 のときのエラーページ(記録しておいた中身から作り直す)
        if (sub === "error" && segments.length === 4 && record.error) {
            // 見ている人の言語で出す(記録したときのリクエストの言語ではなく)
            const page = { ...record.error, lang: d.lang(req) };
            return html(renderPage(PAGE_HTML, page, errorFallback(page)));
        }
    }
    return notFound();
}
