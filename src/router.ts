import type { Handler } from "./context.ts";
import { HttpError, senriError } from "./errors.ts";

export type Route = {
    path: string;
    // path を "/" で分割したもの(登録時に1回だけ作る)
    segments: string[];
    // パラメーターの名前。パスに出てくる順(":id" → "id")
    paramNames: string[];
    method: string;
    handler: Handler;
};

// "/users/:id/posts" → "" | "users" | ":id" | "posts"
type Segment<Path extends string> =
    Path extends `${infer Head}/${infer Rest}` ? Head | Segment<Rest> : Path;

// セグメントが ":" で始まるときだけパラメーター(実行時の matchPath と同じ判定)
// "12:00" のように途中に ":" があるだけのものはパラメーターではない
// 末尾の "*" は、残りのパスを "*" という名前で受け取る
type ParamName<S extends string> = S extends `:${infer Name}` ? Name : S extends "*" ? "*" : never;

export type ExtractParams<Path extends string> =
    // パスが string 型(リテラルでない)だと名前が分からないので、どんな名前でも読めるようにする
    string extends Path
        ? Record<string, string>
        : { [K in ParamName<Segment<Path>>]: string };

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

// app.routes() のキー("GET /users/:id")ごとのハンドラーの型
// 書き方が違うキーには、説明の文字列型を入れておく(ハンドラーを書くと、その文字列と一緒に型エラーになる)
export type RouteTable<K extends string, V extends object = any> = {
    [Key in K]: Key extends `${string} ${infer Path}`
        ? Handler<Simplify<ExtractParams<Path>>, V>
        : 'The route is not written correctly. Put a space between the method and the path, as in "GET /hello"';
};

// ルートのパターン("/users/:id")を分割する。末尾スラッシュや連続スラッシュは無視
export function splitPattern(pattern: string): string[] {
    return pattern.split("/").filter(Boolean);
}

// ほかのフレームワークの書き方のうち、黙って違う動きになるものをエラーにする
// - * を書けるのは、最後のセグメント全体だけ。文字として比べると、どのリクエストにも当たらず、ルートや認証などが黙って動かなくなる
// - ":id?" や ":id{[0-9]+}" は、省略も検証もされず、その文字列ごとパラメーターの名前になる(/users/abc も通ってしまう)
export function checkPathSyntax(path: string, segments: readonly string[]) {
    const last = segments.length - 1;
    if (segments.some((s, i) => s.includes("*") && (s !== "*" || i !== last))) {
        throw senriError("wildcard_position", `"*" must be the whole last segment: ${path}`);
    }
    for (const s of segments) {
        if (s.startsWith(":") && /[?+{}()[\]|:\s]/.test(s.slice(1))) {
            throw senriError("param_name", `Invalid parameter name: "${s.slice(1)}" in ${path}`);
        }
    }
}

// app.use() のパスを確かめて、末尾の "/*" を取る("/admin/*" → "/admin"。どちらも /admin とその下で動く)
export function middlewarePath(path: string): string {
    const segments = splitPattern(path);
    checkPathSyntax(path, segments);
    return segments.at(-1) === "*" ? "/" + segments.slice(0, -1).join("/") : path;
}

// リクエストのパス(URL の pathname)を分割して、セグメントごとにデコードする
// - 末尾スラッシュや連続スラッシュは無視する("/a//b/" は "/a/b" と同じ)
// - "/" ごとに分割してからデコードするので、%2F が区切りと混ざることはないが、
//   紛らわしいので %2F(デコードすると "/" を含む)は 400 にする
// - デコードすると "." や ".." になるものは、パストラバーサルの元なので 400 にする
//   (ふつうは "%2E%2E" も含めて URL の仕様で解決済みなので、ここは念のための防御)
export function splitPath(pathname: string): string[] {
    const segments: string[] = [];
    for (const raw of pathname.split("/")) {
        if (raw === "") continue;

        // "%" がなければデコードしても同じなので、しない(ほとんどのリクエストはこちら)
        // デコードしなければ "/" は含まれない(split で分けたので)
        let segment = raw;
        if (raw.includes("%")) {
            try {
                segment = decodeURIComponent(raw);
            } catch {
                throw new HttpError(400, "400 Bad Request");
            }
            if (segment.includes("/")) throw new HttpError(400, "400 Bad Request");
        }
        if (segment === "." || segment === "..") {
            throw new HttpError(400, "400 Bad Request");
        }
        segments.push(segment);
    }
    return segments;
}

// URL の区切り文字や空白を含む Host は、ふつうのクライアントは送らない
const BAD_HOST = /[\s/?#@\\]/;

// Host ヘッダーを確かめなくてよいランタイムか(Bun だけ)。起動したときに1回だけ決める
// - 確かめるのは、Host をそのままつないで req.url を作るランタイム(Deno)で、パスがすり替わるのを防ぐため
// - Bun は、Host が不正なとき req.url を "/public" のような相対 URL にする。すると pathnameOf の new URL() が
//   失敗して 400 になるので、Host を読まなくても、パスはすり替わらない。この Bun の動きに頼っている
//   (Bun の版が上がって動きが変わったら、test/routing.test.ts の生のソケットで送るテストが CI で落ちる)
// - Bun では、Host を読むとリクエストごとに Headers を作ることになり、1 リクエストあたり 1〜2 µs かかっていた
// - Deno と、どのランタイムか分からないとき(Workers など)は、今までどおり確かめる
// - Node のアダプターは、Request を作る前に自分で Host を確かめる(adapters/node)
const HOST_CHECK_DEFAULT = typeof (globalThis as { Bun?: unknown }).Bun === "undefined";

// リクエストの pathname を取り出す。おかしなリクエストは HttpError(400) にする
// - ランタイムが Host ヘッダーをつないで URL を作ることがある(Deno)。
//   "Host: x/admin#" だと http://x/admin#/public になり、パスが /admin にすり替わるので弾く(checkHost)
// - Bun は Host が不正だと req.url を "/public" のような相対 URL にするので、new URL() が失敗する
// - 速さのため、ふつうは new URL() を使わず req.url の文字列から切り出す。
//   ただし Deno は req.url を正規化しない("/a/../b" のまま来る)ので、"." のセグメント・%2e・\ を含むときだけ
//   new URL() に任せて、URL の仕様どおりに解決させる(どちらで取り出しても、同じ結果になるようにしている)
export function requestPathname(req: Request, checkHost: boolean = HOST_CHECK_DEFAULT): string {
    if (checkHost) {
        const host = req.headers.get("host");
        if (host !== null && BAD_HOST.test(host)) {
            throw new HttpError(400, "400 Bad Request");
        }
    }
    return pathnameOf(req.url);
}

// URL の文字列から pathname を取り出す。Node のアダプターは Host を確かめ、Request を作らずにこちらを呼ぶ
export function pathnameOf(url: string): string {
    const scheme = url.indexOf("://");
    if (scheme !== -1) {
        const start = url.indexOf("/", scheme + 3);
        if (start === -1) return "/";
        // "?" か "#" までがパス。1回の走査で、new URL() に任せるべきもの("/." と "%2e" と "\")も探す
        let needsUrl = false;
        let i = start;
        for (; i < url.length; i++) {
            const ch = url.charCodeAt(i);
            if (ch === 63 || ch === 35) break; // "?" "#"
            if (ch === 92) needsUrl = true; // "\"
            else if (ch === 46 && url.charCodeAt(i - 1) === 47) needsUrl = true; // "/."
            else if (ch === 37 && url.charCodeAt(i + 1) === 50 && (url.charCodeAt(i + 2) | 32) === 101) needsUrl = true; // "%2e" "%2E"
        }
        if (!needsUrl) return url.slice(start, i);
    }
    try {
        return new URL(url).pathname;
    } catch {
        throw new HttpError(400, "400 Bad Request");
    }
}

export function matchPath(pattern: readonly string[], path: readonly string[]): Record<string, string> | null {
    // 末尾の "*" は、残りのセグメント全部に合う(0個でもよい)
    const wild = pattern.at(-1) === "*";
    const fixed = wild ? pattern.length - 1 : pattern.length;

    // 個数が違ったら一致しない
    if (wild ? path.length < fixed : pattern.length !== path.length) {
        return null;
    }

    // 1個ずつ比較する
    const params: Record<string, string> = {};
    if (wild) params["*"] = path.slice(fixed).join("/");

    for (let i = 0; i < fixed; i++) {
        const p = pattern[i]!;
        const actual = path[i]!;

        if (p.startsWith(":")) {
            params[p.slice(1)] = actual;
        } else if (p !== actual) {
            return null;
        }
    }

    return params;
}

// パターンの「形」。パラメーター名は区別しない("/users/:id" と "/users/:name" は同じ "users/:")
export function routeShape(segments: readonly string[]): string {
    return segments.map((s) => (s.startsWith(":") ? ":" : s)).join("/");
}

// パラメーター名が空だったり、1つのパターンで2回使われていたりしたらエラー
// (2回目の値で1回目が黙って上書きされてしまうので)
export function checkParamNames(path: string, segments: readonly string[]) {
    const seen = new Set<string>();
    for (const s of segments) {
        if (!s.startsWith(":")) continue;
        const name = s.slice(1);
        if (name === "") {
            throw senriError("param_empty", `Empty parameter name: ${path}`);
        }
        if (seen.has(name)) {
            throw senriError("param_twice", `Parameter "${name}" used twice: ${path}`);
        }
        seen.add(name);
    }
}

// メソッド名に使える文字(RFC 9110 の token)
const METHOD = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// 登録するメソッド名を確かめて、大文字にする("propfind" → "PROPFIND")
// - CONNECT はプロキシ用、TRACE / TRACK はリクエストをそのまま返すので Cookie を盗む攻撃(XST)に使われる。どれも扱わない
// - "ALL" は app.all() の印として使っているので、app.on() からは登録させない
export function normalizeMethod(method: string): string {
    if (!METHOD.test(method)) throw senriError("method_invalid", `Invalid method: ${JSON.stringify(method)}`);
    const upper = method.toUpperCase();
    if (upper === "CONNECT" || upper === "TRACE" || upper === "TRACK") {
        throw senriError("method_unsupported", `${upper} is not supported`);
    }
    return upper;
}

// Allow ヘッダーに入れるメソッドの一覧("GET, HEAD, POST, OPTIONS")
// GET があれば HEAD も使える(GET にフォールバックするので)。OPTIONS はいつでも使える
export function allowedMethods(routes: readonly Route[]): string {
    const methods: string[] = [];
    for (const r of routes) {
        if (!methods.includes(r.method)) methods.push(r.method);
        if (r.method === "GET" && !methods.includes("HEAD")) methods.push("HEAD");
    }
    if (!methods.includes("OPTIONS")) methods.push("OPTIONS");
    return methods.join(", ");
}

// path の先頭が prefix と一致するか。セグメント単位で比べるので "/admin" は "/administrator" にはマッチしない
// プレフィックスの ":id" のようなパラメーターは、どんなセグメントにも合う(matchPath と同じ判定)
export function startsWithSegments(path: readonly string[], prefix: readonly string[]): boolean {
    if (path.length < prefix.length) return false;
    return prefix.every((p, i) => p.startsWith(":") || p === path[i]);
}

// sort 用の比較関数。どの2つを比べても答えが矛盾しない(=並び順が一意に決まる)ようにする
export function compareRoutes(a: Route, b: Route): number {
    const aParts = a.segments;
    const bParts = b.segments;

    // 前から見て最初に種類が違うところで決める。静的 → パラメーター → ワイルドカードの順
    // ワイルドカードがあると、セグメント数が違うルート同士も同じパスにマッチするので、数は最後に比べる
    const shorter = Math.min(aParts.length, bParts.length);
    for (let i = 0; i < shorter; i++) {
        const diff = segmentRank(aParts[i]!) - segmentRank(bParts[i]!);
        if (diff !== 0) return diff;
    }
    return aParts.length - bParts.length;
}

function segmentRank(segment: string): number {
    return segment === "*" ? 2 : segment.startsWith(":") ? 1 : 0;
}
