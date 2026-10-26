// ダッシュボードの計算・判断だけを集めたもの(DOM も Vue も使わないので、bun test でそのまま試せる)
import type { MiddlewareRow, RequestSummary, RouteRow } from "../../src/dev/page-data.ts";
import type { DashboardRecord, LayerState } from "../../src/dev/dashboard/record.ts";

// --- 一覧 ---

// "all" か、ステータスの百の位("2" / "4" / "5")
export type StatusFilter = "all" | "2" | "4" | "5";

export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "2", label: "2xx" },
    { id: "4", label: "4xx" },
    { id: "5", label: "5xx" },
];

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

export function timeline(r: DashboardRecord): TimelineBar[] {
    const total = r.durationMs;
    return r.layers.map((l) => {
        // 未到達の層や、全体が 0ms のときは、横いっぱいに置く(棒の中身で状態を見せる)
        const whole = l.state === "skipped" || total <= 0;
        const left = whole ? 0 : clamp((l.start / total) * 100);
        const width = whole ? 100 : Math.min(clamp((l.total / total) * 100), 100 - left);
        const label =
            l.state === "skipped"
                ? "未到達"
                : l.state === "failed"
                  ? `${formatMs(l.self)} ✕ 例外`
                  : l.state === "stopped"
                    ? `${formatMs(l.self)} ← ここで終了`
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

export function middlewareScope(path: string | null): string {
    return path === null ? "すべてのパス" : `${path} とその下`;
}

export function formatAverage(m: MiddlewareRow): string {
    return m.avgSelfMs === null ? "—" : `平均 ${formatMs(m.avgSelfMs)}(${m.runs}件)`;
}

// タイムラインの下に出す説明(何が起きたか)。言うことがなければ空
export function describeRequest(r: DashboardRecord): string {
    const stopped = r.layers.find((l) => l.state === "stopped");
    if (stopped) {
        const skipped = r.layers.find((l) => l.state === "skipped");
        return `${stopped.name} が next() を呼ばずに ${r.status} を返したので、${skipped?.name ?? "内側"} には届いていません。`;
    }
    const failed = r.layers.find((l) => l.state === "failed");
    if (failed) return `${failed.name} で例外が起きて、onError が ${r.status} を返しました。`;

    if (r.layers.at(-1)?.name === "notFound") return "一致するルートがないので notFound が動きました。";

    // 1つの層が、時間の大半(75% 以上)を使っていれば知らせる
    if (r.durationMs > 0) {
        const busiest = [...r.layers].sort((a, b) => b.self - a.self)[0];
        if (busiest) {
            const pct = Math.round((busiest.self / r.durationMs) * 100);
            if (pct >= 75) return `ほとんどの時間(${pct}%)は ${busiest.name} で使われています。`;
        }
    }
    return "";
}
