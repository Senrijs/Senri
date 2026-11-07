// 開発モードの、ルートとミドルウェアの書き間違いの警告
// 登録時のエラーにしない(本当にそのつもりのこともある)ものだけを、ルートが出揃ったあとに知らせる
import type { Lang } from "../lang.ts";
import { splitPattern } from "../router.ts";
import { serverMessage } from "./server-messages.ts";
import { suggest } from "./suggest.ts";

type RouteInfo = { method: string; path: string };
type MiddlewareInfo = { name: string; path: string | null };

// ほかのフレームワークの書き方に見える文字。Senri では文字として比べる
// "+" は /c++ のように本当に使うことがあるので入れない
const LITERAL_SYNTAX = /[?{}()[\]|]/;

// パス指定のミドルウェア(prefix)が、ルートのパターンにかかるか
// セグメントごとに比べ、ルートのほうがパラメーター(":id")やワイルドカードなら「パスによる」
// プレフィックスのパラメーターは、どのセグメントにも合う
export function applies(prefix: string[] | null, route: string[]): "yes" | "no" | "maybe" {
    if (prefix === null) return "yes";
    let maybe = false;
    for (let i = 0; i < prefix.length; i++) {
        if (route[i] === "*") return "maybe";
        if (i >= route.length) return "no";
        if (route[i]!.startsWith(":")) maybe ||= !prefix[i]!.startsWith(":");
        else if (!prefix[i]!.startsWith(":") && route[i] !== prefix[i]) return "no";
    }
    return maybe ? "maybe" : "yes";
}

function syntaxWarning(where: string, path: string, lang: Lang): string | null {
    for (const s of splitPattern(path)) {
        // ":file.png" は、".png" で終わるものではなく、"file.png" という名前のパラメーターになる
        if (s.startsWith(":")) {
            if (!s.includes(".")) continue;
            return serverMessage(lang, "warn.paramDot", { where, name: s.slice(1) });
        }
        if (LITERAL_SYNTAX.test(s)) {
            return serverMessage(lang, "warn.literal", { where, segment: s });
        }
    }
    return null;
}

// ミドルウェアと同じ段数に切ったルートのうち、いちばん近いもの("/admni" は "/admin/users" の "/admin" と比べる)
function closestPrefix(routes: RouteInfo[], path: string, depth: number): string | null {
    const candidates = routes
        .map((r) => ({ path: "/" + splitPattern(r.path).slice(0, depth).join("/") }))
        .filter((r) => r.path !== "/" && !r.path.includes("*"));
    return suggest(candidates, path)?.path ?? null;
}

function unmatchedWarning(m: MiddlewareInfo, prefix: string[], routes: RouteInfo[], lang: Lang): string | null {
    // "/*" は何にでも当たるので、当たった数に入れない(入れると、SPA の fallback があるだけで何も警告できなくなる)
    const others = routes.filter((r) => r.path !== "/*");
    if (others.some((r) => applies(prefix, splitPattern(r.path)) !== "no")) return null;

    const close = closestPrefix(others, m.path!, prefix.length);
    // "/*" があるときは、そこに当たっている可能性もあるので、打ち間違いらしいときだけ知らせる
    if (!close && others.length !== routes.length) return null;
    const params = { name: m.name, path: m.path! };
    return close ? serverMessage(lang, "warn.unmatchedClose", { ...params, close }) : serverMessage(lang, "warn.unmatched", params);
}

/** Checks the registered routes and middleware for likely mistakes. */
export function routeWarnings(routes: RouteInfo[], middlewares: MiddlewareInfo[], lang: Lang): string[] {
    const warnings: string[] = [];
    for (const r of routes) {
        const w = syntaxWarning(`Route "${r.method} ${r.path}"`, r.path, lang);
        if (w) warnings.push(w);
    }
    for (const m of middlewares) {
        if (m.path === null) continue;
        const syntax = syntaxWarning(`Middleware "${m.name}" at "${m.path}"`, m.path, lang);
        if (syntax) warnings.push(syntax);
        const prefix = splitPattern(m.path);
        if (prefix.length === 0) continue;
        const unmatched = unmatchedWarning(m, prefix, routes, lang);
        if (unmatched) warnings.push(unmatched);
    }
    return warnings;
}
