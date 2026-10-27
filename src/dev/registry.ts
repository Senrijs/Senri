// アプリとダッシュボードの対応(テストで中身を確かめるのに使う)
// @senrijs/senri/dev の入口からは出さない(利用者向けの API ではないので)
import type { Dashboard } from "./dashboard/index.ts";

const dashboards = new WeakMap<object, Dashboard>();

export function registerDashboard(app: object, dashboard: Dashboard): void {
    dashboards.set(app, dashboard);
}

export async function dashboardOf(app: object): Promise<Dashboard | undefined> {
    return dashboards.get(app);
}
