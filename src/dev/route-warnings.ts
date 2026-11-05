// 開発モードの、ルートとミドルウェアの書き間違いの警告
// 登録時のエラーにしない(本当にそのつもりのこともある)ものだけを、ルートが出揃ったあとに知らせる
import { splitPattern } from "../router.ts";
import { suggest } from "./suggest.ts";

/** A likely mistake in a route or middleware path. `text` is English; `ja` is the same in Japanese. */
export type RouteWarning = { text: string; ja: string };

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

function syntaxWarning(where: string, path: string): RouteWarning | null {
    for (const s of splitPattern(path)) {
        // ":file.png" は、".png" で終わるものではなく、"file.png" という名前のパラメーターになる
        if (s.startsWith(":")) {
            if (!s.includes(".")) continue;
            const name = s.slice(1);
            return {
                text: `${where}: the parameter is named "${name}". Senri does not split a parameter at "."; check the value in the handler or with a schema.`,
                ja: `${where}: パラメーターの名前が "${name}" になります。Senri は "." でパラメーターを分けません。ハンドラーかスキーマで確かめてください`,
            };
        }
        if (LITERAL_SYNTAX.test(s)) {
            return {
                text: `${where}: "${s}" is compared as literal text. Senri has no optional segments or patterns; use ":name" or "*".`,
                ja: `${where}: "${s}" は文字として比べます。Senri に省略できるセグメントやパターンはありません。":name" か "*" を使ってください`,
            };
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

function unmatchedWarning(m: MiddlewareInfo, prefix: string[], routes: RouteInfo[]): RouteWarning | null {
    // "/*" は何にでも当たるので、当たった数に入れない(入れると、SPA の fallback があるだけで何も警告できなくなる)
    const others = routes.filter((r) => r.path !== "/*");
    if (others.some((r) => applies(prefix, splitPattern(r.path)) !== "no")) return null;

    const close = closestPrefix(others, m.path!, prefix.length);
    // "/*" があるときは、そこに当たっている可能性もあるので、打ち間違いらしいときだけ知らせる
    if (!close && others.length !== routes.length) return null;
    return {
        text: `Middleware "${m.name}" at "${m.path}" matches no route.${close ? ` Did you mean "${close}"?` : ""} Ignore this if it answers by itself.`,
        ja: `"${m.path}" のミドルウェア(${m.name})は、どのルートにも当たりません。${close ? `"${close}" の打ち間違いではありませんか？` : "打ち間違いではありませんか？"}ルートなしで自分で返すミドルウェアなら、問題ありません`,
    };
}

/** Checks the registered routes and middleware for likely mistakes. */
export function routeWarnings(routes: RouteInfo[], middlewares: MiddlewareInfo[]): RouteWarning[] {
    const warnings: RouteWarning[] = [];
    for (const r of routes) {
        const w = syntaxWarning(`Route "${r.method} ${r.path}"`, r.path);
        if (w) warnings.push(w);
    }
    for (const m of middlewares) {
        if (m.path === null) continue;
        const syntax = syntaxWarning(`Middleware "${m.name}" at "${m.path}"`, m.path);
        if (syntax) warnings.push(syntax);
        const prefix = splitPattern(m.path);
        if (prefix.length === 0) continue;
        const unmatched = unmatchedWarning(m, prefix, routes);
        if (unmatched) warnings.push(unmatched);
    }
    return warnings;
}
