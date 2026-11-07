// ダッシュボードの計算・判断だけを集めたもの(DOM も Vue も使わないので、bun test でそのまま試せる)
import type { Lang } from "../../src/lang.ts";
import { message } from "../../src/dev/messages.ts";
import type { MiddlewareRow, RequestSummary, RouteRow } from "../../src/dev/page-data.ts";
import type { DashboardRecord, LayerState } from "../../src/dev/dashboard/record.ts";

// --- 一覧 ---

// "all" か、ステータスの百の位("2" / "4" / "5")
export type StatusFilter = "all" | "2" | "4" | "5";

export function statusFilters(lang: Lang): { id: StatusFilter; label: string }[] {
    return [
        { id: "all", label: message(lang, "dash.all") },
        { id: "2", label: "2xx" },
        { id: "4", label: "4xx" },
        { id: "5", label: "5xx" },
    ];
}

export function filterRequests(list: RequestSummary[], query: string, status: StatusFilter): RequestSummary[] {
    const q = query.trim().toLowerCase();
    return list.filter(
        (r) => (status === "all" || String(r.status)[0] === status) && (q === "" || r.path.toLowerCase().includes(q)),
    );
}

export function statusClass(status: number): "ok" | "redirect" | "warn" | "error" {
    if (status >= 500) return "error";
    if (status >= 400) return "warn";
    if (status >= 300) return "redirect";
    return "ok";
}

export function formatTime(epochMs: number): string {
    const d = new Date(epochMs);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export const formatMs = (ms: number) => `${ms.toFixed(1)}ms`;

// --- SSE のイベントを一覧に反映する ---

export type DashboardEvent = { type: "request"; item: RequestSummary } | { type: "clear" };

export function applyEvent(list: RequestSummary[], event: DashboardEvent, max: number): RequestSummary[] {
    if (event.type === "clear") return [];
    // 再接続で一覧を取り直したときなどに、同じものが二重に届いても1件だけにする
    const rest = list.filter((r) => r.id !== event.item.id);
    return [event.item, ...rest].slice(0, max);
}

// --- 詳細の取得 ---

// 最後に始めたものだけを採用する仕組み
// 行 A の詳細を取りに行っている間に行 B を選ぶと、A の結果があとから届くことがある。
// start() で世代を進め、結果が届いたときに、返ってきた関数で「まだ最新か」を確かめる
export function latestOnly() {
    let current = 0;
    return {
        start(): () => boolean {
            const mine = ++current;
            return () => mine === current;
        },
    };
}

// --- 玉ねぎタイムライン ---

export type TimelineBar = {
    name: string;
    // 字下げ(外側から何番目か)
    indent: number;
    // 棒の位置と幅(リクエスト全体に対する %)。下流込みの時間
    left: number;
    width: number;
    // 棒の中の「自分の時間」の幅(棒に対する %)
    selfWidth: number;
    state: LayerState;
    label: string;
};

const clamp = (n: number) => Math.min(Math.max(n, 0), 100);

export function timeline(r: DashboardRecord, lang: Lang): TimelineBar[] {
    const total = r.durationMs;
    return r.layers.map((l) => {
        // 未到達の層や、全体が 0ms のときは、横いっぱいに置く(棒の中身で状態を見せる)
        const whole = l.state === "skipped" || total <= 0;
        const left = whole ? 0 : clamp((l.start / total) * 100);
        const width = whole ? 100 : Math.min(clamp((l.total / total) * 100), 100 - left);
        const label =
            l.state === "skipped"
                ? message(lang, "dash.skipped")
                : l.state === "failed"
                  ? message(lang, "dash.failed", { ms: formatMs(l.self) })
                  : l.state === "stopped"
                    ? message(lang, "dash.stopped", { ms: formatMs(l.self) })
                    : `self ${l.self.toFixed(1)} / ${formatMs(l.total)}`;
        return {
            name: l.name,
            indent: l.depth,
            left,
            width,
            selfWidth: l.total > 0 ? clamp((l.self / l.total) * 100) : 100,
            state: l.state,
            label,
        };
    });
}

// --- ルートのタブ ---

// そのルートに来たリクエストが、どのミドルウェアを順に通ってハンドラーに着くか
// (かからないものは省く。パスによるもの ":page" などは maybe の印を付ける)
export function routeChain(row: RouteRow): { name: string; maybe: boolean }[] {
    return [
        ...row.middlewares.filter((m) => m.applies !== "no").map((m) => ({ name: m.name, maybe: m.applies === "maybe" })),
        { name: "handler", maybe: false },
    ];
}

// --- ミドルウェアのタブ ---

export function middlewareScope(path: string | null, lang: Lang): string {
    return path === null ? message(lang, "mw.allPaths") : message(lang, "mw.under", { path });
}

// 無名のミドルウェア(anonymous#番号)があるときの案内。なければ null
export function anonymousHint(rows: MiddlewareRow[], lang: Lang): string | null {
    if (!rows.some((m) => m.anonymous)) return null;
    return message(lang, "mw.anonymous");
}

export function formatAverage(m: MiddlewareRow, lang: Lang): string {
    return m.avgSelfMs === null ? "—" : message(lang, "mw.average", { ms: formatMs(m.avgSelfMs), count: m.runs });
}

// タイムラインの下に出す説明(何が起きたか)。言うことがなければ空
export function describeRequest(r: DashboardRecord, lang: Lang): string {
    const stopped = r.layers.find((l) => l.state === "stopped");
    if (stopped) {
        const skipped = r.layers.find((l) => l.state === "skipped");
        return message(lang, "dash.describeStopped", { name: stopped.name, status: r.status, inner: skipped?.name ?? message(lang, "dash.inner") });
    }
    const failed = r.layers.find((l) => l.state === "failed");
    if (failed) return message(lang, "dash.describeFailed", { name: failed.name, status: r.status });

    if (r.layers.at(-1)?.name === "notFound") return message(lang, "dash.describeNotFound");

    // 1つの層が、時間の大半(75% 以上)を使っていれば知らせる
    if (r.durationMs > 0) {
        const busiest = [...r.layers].sort((a, b) => b.self - a.self)[0];
        if (busiest) {
            const pct = Math.round((busiest.self / r.durationMs) * 100);
            if (pct >= 75) return message(lang, "dash.describeBusy", { pct, name: busiest.name });
        }
    }
    return "";
}
