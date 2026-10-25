import { Context, type Handler, type Middleware } from "./context.ts";
import {
    compareRoutes,
    matchPath,
    splitPattern,
    startsWithSegments,
    type ExtractParams,
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
        routes.push({ path, segments: splitPattern(path), method, handler });
        routes.sort(compareRoutes);
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

        delete<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>>) {
            add("DELETE", path, handler as Handler);
        },

        routes(table: Record<string, Handler>) {
            for (const [key, handler] of Object.entries(table)) {
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

            const run = async (): Promise<Response> => {
                const path = new URL(req.url).pathname;
                // デコードに失敗したら HttpError(400) が投げられる
                const segments = c.segments;

                for (const route of routes) {
                    if (route.method !== req.method) continue;
                    const params = matchPath(route.segments, segments);
                    if (params === null) continue;
                    return c.toResponse(await route.handler(params, c));
                }

                const samePath = routes.filter((r) => matchPath(r.segments, segments) !== null);
                if (samePath.length > 0) {
                    throw methodNotAllowed(c, path, samePath.map((r) => r.method).join(", "), dev);
                }

                c.status(404);
                return c.toResponse(await notFound(c));
            };

            // ハンドラー・notFound・toResponse のどこで投げても onError に集める
            const handle = async (): Promise<Response> => {
                try {
                    return await run();
                } catch (err) {
                    return fail(err);
                }
            };

            return compose(applicableMiddlewares(c), c, handle, fail);
        },
    };
}
