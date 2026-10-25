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
import { compose } from "./compose.ts";
import {
    defaultNotFound,
    defaultOnError,
    handleError,
    methodNotAllowed,
    type ErrorHandler,
    type NotFoundHandler,
} from "./errors.ts";

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

export function createApp(options: AppOptions = {}) {
    const dev = options.dev ?? false;
    const routes: Route[] = [];
    // prefix が null なら全部のリクエストで動く。["admin"] なら /admin とその下だけ
    const middlewares: { prefix: string[] | null; mw: Middleware }[] = [];
    let onError: ErrorHandler = defaultOnError(dev);
    let notFound: NotFoundHandler = defaultNotFound(routes, dev);

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

    function applicableMiddlewares(c: Context): Middleware[] {
        let segments: readonly string[] | null;
        try {
            segments = c.segments;
        } catch {
            // パスが不正なら、パス指定のミドルウェアは動かさない(どのみちルーターが 400 にする)
            segments = null;
        }
        return middlewares
            .filter(({ prefix }) => prefix === null || (segments !== null && startsWithSegments(segments, prefix)))
            .map(({ mw }) => mw);
    }

    return {
        use(pathOrMw: string | Middleware, mw?: Middleware) {
            if (typeof pathOrMw === "string") {
                if (!mw) throw new Error(`app.use("${pathOrMw}", ...) にミドルウェアがありません`);
                middlewares.push({ prefix: splitPattern(pathOrMw), mw });
            } else {
                middlewares.push({ prefix: null, mw: pathOrMw });
            }
        },

        onError(handler: ErrorHandler) {
            onError = handler;
        },

        notFound(handler: NotFoundHandler) {
            notFound = handler;
        },

        get<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>>) {
            add("GET", path, handler as Handler);
        },

        post<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>>) {
            add("POST", path, handler as Handler);
        },

        put<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>>) {
            add("PUT", path, handler as Handler);
        },

        patch<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>>) {
            add("PATCH", path, handler as Handler);
        },

        delete<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>>) {
            add("DELETE", path, handler as Handler);
        },

        // どのメソッドでも動く。ただし、メソッドが合うルートがあればそちらが優先
        all<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>>) {
            add("ALL", path, handler as Handler);
        },

        // K はテーブルのキーから推論される。各キーのパスからパラメーターの型が決まる
        routes<K extends string>(table: RouteTable<K>) {
            for (const [key, handler] of Object.entries(table) as [string, Handler][]) {
                const [method, path] = key.split(" ");
                if (!method || !path) {
                    throw new Error(`ルートの書き方が違います: "${key}"\n例: "GET /hello"`);
                }

                add(method.toUpperCase(), path, handler);
            }
        },

        routeList() {
            return routes.map((r) => ({ method: r.method, path: r.path }));
        },

        async fetch(req: Request): Promise<Response> {
            const c = new Context(req);
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
                        const res = c.toResponse(await resolved.route.handler(c.params, c));
                        if (req.method !== "HEAD") return res;
                        // HEAD はヘッダーと status だけ返す(ボディは捨てる)
                        await res.body?.cancel();
                        return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
                    }
                    case "options":
                        return new Response(null, { status: 204, headers: { allow: resolved.allow } });
                    case "methodNotAllowed":
                        throw methodNotAllowed(c, new URL(req.url).pathname, resolved.allow, dev);
                    case "notFound":
                        c.status(404);
                        return c.toResponse(await notFound(c));
                }
            };

            // ハンドラー・notFound・toResponse のどこで投げても onError に集める
            const handle = async (): Promise<Response> => {
                try {
                    return await run();
                } catch (err) {
                    return fail(err);
                }
            };

            const res = await compose(applicableMiddlewares(c), c, handle, fail);
            return c.finalize(res);
        },
    };
}
