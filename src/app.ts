import { Context, type Handler, type Middleware } from "./context.ts";
import {
    compareRoutes,
    matchPath,
    allowedMethods,
    checkParamNames,
    routeShape,
    splitPattern,
    startsWithSegments,
    type ExtractParams,
    type RouteTable,
    type Route,
    type Simplify,
} from "./router.ts";
import { compose, toResponseOf, type Layer } from "./compose.ts";
import {
    defaultNotFound,
    defaultOnError,
    handleError,
    methodNotAllowed,
    type ErrorHandler,
    type NotFoundHandler,
} from "./errors.ts";
import { finishErrorPage, withErrorPage } from "./dev/pages.ts";

// リクエストをどう処理するかの結論。ミドルウェアより前に1回だけ決める
type Resolved =
    | { kind: "route"; route: Route; params: Record<string, string> }
    | { kind: "options"; allow: string }
    | { kind: "methodNotAllowed"; allow: string }
    | { kind: "notFound" }
    | { kind: "badRequest"; error: unknown };

export type AppOptions = {
    // 開発モード。エラーの詳細や「もしかして」を返す。本番では絶対にオンにしない
    // 環境変数からは読まない(Deno では --allow-env がないと読めない、などランタイム差があるため)
    dev?: boolean;
};

// V は c.set / c.get で使う変数の型。createApp<{ user: User }>() のように指定する
export function createApp<V extends object = Record<string, unknown>>(options: AppOptions = {}) {
    const dev = options.dev ?? false;
    const routes: Route[] = [];
    // prefix が null なら全部のリクエストで動く。["admin"] なら /admin とその下だけ
    const middlewares: { name: string; path: string | null; prefix: string[] | null; mw: Middleware<V> }[] = [];
    // 開発モードでは、ブラウザから開いた 5xx を HTML のエラーページにする(src/dev/pages.ts)
    let onError: ErrorHandler<V> = withErrorPage(defaultOnError(dev), dev);
    let notFound: NotFoundHandler<V> = defaultNotFound(routes, dev);

    function add(method: string, path: string, handler: Handler) {
        const segments = splitPattern(path);
        checkParamNames(path, segments);

        // 同じメソッド + 同じ形のパスがあったら、あとから登録したほうは絶対に呼ばれないのでエラーにする
        const shape = routeShape(segments);
        const dup = routes.find((r) => r.method === method && routeShape(r.segments) === shape);
        if (dup) {
            const samePath = dup.segments.join("/") === segments.join("/");
            throw new Error(
                samePath
                    ? `${method} ${path} はすでに登録されています`
                    : `${method} ${path} は、登録済みの ${dup.method} ${dup.path} と同じパスです(パラメーター名が違うだけです)`,
            );
        }

        routes.push({ path, segments, method, handler });
        routes.sort(compareRoutes);
    }

    function resolve(c: Context): Resolved {
        let segments: readonly string[];
        try {
            segments = c.segments;
        } catch (error) {
            // エンコードが不正(HttpError 400)。ミドルウェアは動かしてから返す
            return { kind: "badRequest", error };
        }
        const method = c.req.method;

        // パスが合うルートを、優先順位の順に集める(メソッドはまだ見ない)
        const matched: { route: Route; params: Record<string, string> }[] = [];
        for (const route of routes) {
            const params = matchPath(route.segments, segments);
            if (params !== null) matched.push({ route, params });
        }
        const find = (m: string) => matched.find((x) => x.route.method === m);

        // 1. メソッドが合うもの → 2. HEAD なら GET → 3. all の順に探す
        const hit = find(method) ?? (method === "HEAD" ? find("GET") : undefined) ?? find("ALL");
        if (hit) return { kind: "route", ...hit };

        if (matched.length === 0) return { kind: "notFound" };
        const allow = allowedMethods(matched.map((x) => x.route));
        return method === "OPTIONS" ? { kind: "options", allow } : { kind: "methodNotAllowed", allow };
    }

    function applicableMiddlewares(c: Context): Layer[] {
        let segments: readonly string[] | null;
        try {
            segments = c.segments;
        } catch {
            // パスが不正なら、パス指定のミドルウェアは動かさない(どのみちルーターが 400 にする)
            segments = null;
        }
        return middlewares
            .filter(({ prefix }) => prefix === null || (segments !== null && startsWithSegments(segments, prefix)))
            .map(({ name, mw }) => ({ name, mw }));
    }

    return {
        use(pathOrMw: string | Middleware<V>, mw?: Middleware<V>) {
            const path = typeof pathOrMw === "string" ? pathOrMw : null;
            const fn = typeof pathOrMw === "string" ? mw : pathOrMw;
            if (!fn) throw new Error(`app.use("${path}", ...) にミドルウェアがありません`);

            middlewares.push({
                // 関数の名前を使う。無名の関数(その場で書いたアロー関数など)は登録順の番号で呼ぶ
                name: fn.name || `anonymous#${middlewares.length + 1}`,
                path,
                prefix: path === null ? null : splitPattern(path),
                mw: fn,
            });
        },

        onError(handler: ErrorHandler<V>) {
            onError = handler;
        },

        notFound(handler: NotFoundHandler<V>) {
            notFound = handler;
        },

        get<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("GET", path, handler as Handler);
        },

        post<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("POST", path, handler as Handler);
        },

        put<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("PUT", path, handler as Handler);
        },

        patch<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("PATCH", path, handler as Handler);
        },

        delete<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("DELETE", path, handler as Handler);
        },

        // どのメソッドでも動く。ただし、メソッドが合うルートがあればそちらが優先
        all<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("ALL", path, handler as Handler);
        },

        // K はテーブルのキーから推論される。各キーのパスからパラメーターの型が決まる
        routes<K extends string>(table: RouteTable<K, V>) {
            for (const [key, handler] of Object.entries(table) as [string, Handler][]) {
                const [method, path] = key.split(" ");
                if (!method || !path) {
                    throw new Error(`ルートの書き方が違います: "${key}"\n例: "GET /hello"`);
                }

                add(method.toUpperCase(), path, handler);
            }
        },

        middlewareList() {
            return middlewares.map((m) => ({ name: m.name, path: m.path }));
        },

        routeList() {
            return routes.map((r) => ({ method: r.method, path: r.path }));
        },

        async fetch(req: Request): Promise<Response> {
            const c = new Context<V>(req);
            const fail = (err: unknown) => handleError(err, c, onError);

            // ミドルウェアより先にマッチして、c.route / c.params を見られるようにしておく
            const resolved = resolve(c);
            if (resolved.kind === "route") {
                c.route = resolved.route.path;
                c.params = resolved.params;
            }

            // ミドルウェアを全部通ったあとに動く、いちばん内側の処理
            const run = async (): Promise<Response> => {
                switch (resolved.kind) {
                    case "badRequest":
                        throw resolved.error;
                    case "route": {
                        const result = await resolved.route.handler(c.params, c);
                        const res = toResponseOf(c, result, {
                            kind: "handler",
                            name: `${resolved.route.method} ${resolved.route.path}`,
                        });
                        if (req.method !== "HEAD") return res;
                        // HEAD はヘッダーと status だけ返す(ボディは捨てる)
                        await res.body?.cancel();
                        return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
                    }
                    case "options":
                        return new Response(null, { status: 204, headers: { allow: resolved.allow } });
                    case "methodNotAllowed":
                        throw methodNotAllowed(c, c.path, resolved.allow, dev);
                    case "notFound":
                        c.status(404);
                        return c.toResponse(await notFound(c));
                }
            };

            // ハンドラー・notFound・toResponse のどこで投げても、compose が onError に集める
            // 開発モードのときだけ計測する(本番では performance.now() の分も払わない)
            const res = await compose(applicableMiddlewares(c), c, run, fail, dev ? c.timings : undefined);
            // ミドルウェアを全部通ったあとなので、ここなら「通った順番」が揃っている
            const page = dev ? await finishErrorPage(c, res) : res;
            return c.finalize(page);
        },
    };
}
