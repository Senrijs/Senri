// エラーページや404ページから、ダッシュボードのそのリクエストを開くリンク
// ダッシュボードを開けるリクエスト(localhost から)のときだけ、begin() で覚えておく
import type { Context } from "../../context.ts";

const links = new WeakMap<Context<any, any>, string>();

export function setDashboardLink(c: Context<any, any>, url: string) {
    links.set(c, url);
}

// 開けないとき(localhost 以外、接続元不明、本番)は null
export function dashboardLinkOf(c: Context<any, any>): string | null {
    return links.get(c) ?? null;
}
