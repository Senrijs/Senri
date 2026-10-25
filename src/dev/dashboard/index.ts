// 開発ダッシュボード(/_senri)の本体。アプリごとに1つ作る(開発モードのときだけ)
import type { Context } from "../../context.ts";
import { RequestLog } from "./log.ts";
import { buildRecord, type DashboardRecord } from "./record.ts";

// ルートとミドルウェアのタブに出すもの(アプリから受け取る)
export type DashboardSource = {
    routes(): { method: string; path: string }[];
    middlewares(): { name: string; path: string | null }[];
};

export function createDashboard(source: DashboardSource) {
    const log = new RequestLog<DashboardRecord>();
    // リクエストごとの id。エラーページの「/_senri で詳しく見る」から、そのリクエストを開くのに使う
    const ids = new WeakMap<Context, string>();
    let nextId = 1;

    return {
        log,
        source,

        // リクエストの最初に呼ぶ。id を振って、受け付けた時刻を覚える
        begin(c: Context): string {
            const id = String(nextId++);
            ids.set(c, id);
            return id;
        },

        idOf(c: Context): string | undefined {
            return ids.get(c);
        },

        // レスポンスを返す直前に呼ぶ。記録に失敗しても、リクエストには影響させない
        async record(c: Context, res: Response, time: number, layerNames: string[]) {
            const id = ids.get(c);
            if (id === undefined) return;
            try {
                log.add(await buildRecord({ id, time, c, res, layerNames }));
            } catch {
                // 記録はおまけなので、失敗しても黙って捨てる
            }
        },
    };
}

export type Dashboard = ReturnType<typeof createDashboard>;
