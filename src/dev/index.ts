// 開発モードだけで使うものの入口。app.ts は dev: true のときだけ、これを import() で読み込む
// (本番ではエラーページの HTML やダッシュボードを読み込まない)
import type { Dashboard } from "./dashboard/index.ts";

export { finishErrorPage, withErrorPage } from "./pages.ts";
export { createDashboard, type Dashboard } from "./dashboard/index.ts";

// アプリとダッシュボードの対応(テストで中身を確かめるのに使う)
const dashboards = new WeakMap<object, Dashboard>();

export function registerDashboard(app: object, dashboard: Dashboard) {
    dashboards.set(app, dashboard);
}

export async function dashboardOf(app: object): Promise<Dashboard | undefined> {
    return dashboards.get(app);
}
