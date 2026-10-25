// エラーページや404ページから、ダッシュボードのそのリクエストを開くリンク
// ダッシュボードを開けるリクエスト(localhost から)のときだけ、begin() で覚えておく
import type { Context } from "../../context.ts";

const links = new WeakMap<Context, string>();

export function setDashboardLink(c: Context, url: string) {
    links.set(c, url);
}

// 開けないとき(localhost 以外、接続元不明、本番)は null
export function dashboardLinkOf(c: Context): string | null {
    return links.get(c) ?? null;
}
