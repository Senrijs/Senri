// Origin ヘッダーの確かめ方(csrf() と upgradeWebSocket() で同じものを使う)
import type { Context } from "../context.ts";
import { senriError } from "../errors.ts";
import { headerOf, urlOf } from "../plain.ts";

/**
 * Other origins to allow, such as `"https://admin.example.com"` (scheme, host and port only), or a function that
 * decides.
 */
export type OriginOption = string | readonly string[] | ((origin: string, c: Context) => boolean);

// origin の指定から、Origin ヘッダーの値を許すかを決める関数を作る
// code と name は、指定がおかしいときのエラーに使う(csrf_origin / "csrf()" など)
export function originMatcher(origin: OriginOption | undefined, code: string, name: string): (value: string, c: Context) => boolean {
    if (origin === undefined) return () => false;
    if (typeof origin === "function") return (value, c) => origin(value, c) === true;
    const list = typeof origin === "string" ? [origin] : origin;
    if (!Array.isArray(list) || list.some((o) => typeof o !== "string" || !/^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]+$/i.test(o))) {
        throw senriError(code, new TypeError(`${name}: origin must be like "https://example.com" (no path or trailing slash)`));
    }
    const allowed = new Set(list.map((o) => o.toLowerCase()));
    return (value) => allowed.has(value.toLowerCase());
}

// Origin のホスト(とポート)が、リクエストのホストと同じか
// スキームは比べない(TLS を終えるプロキシの後ろでは、アプリから見たリクエストが http になるため。Go と同じ)
export function sameHost(origin: string, c: Context): boolean {
    let originHost: string;
    try {
        originHost = new URL(origin).host;
    } catch {
        return false;
    }
    const host = headerOf(c, "host") ?? new URL(urlOf(c)).host;
    return originHost !== "" && originHost === host.toLowerCase();
}
