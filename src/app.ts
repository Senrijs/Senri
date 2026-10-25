import { Context, type Handler, type Middleware } from "./context.ts";
import { compareRoutes, matchPath, type ExtractParams, type Route, type Simplify } from "./router.ts";
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
    const middlewares: Middleware[] = [];
    let onError: ErrorHandler = defaultOnError(dev);
    let notFound: NotFoundHandler = defaultNotFound(routes, dev);

    function add(method: string, path: string, handler: Handler) {
        routes.push({ path, method, handler });
        routes.sort(compareRoutes);
    }

    return {
        use(mw: Middleware) {
            middlewares.push(mw);
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

                for (const route of routes) {
                    if (route.method !== req.method) continue;
                    const params = matchPath(route.path, path);
                    if (params === null) continue;
                    return c.toResponse(await route.handler(params, c));
                }

                const samePath = routes.filter((r) => matchPath(r.path, path) !== null);
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

            return compose(middlewares, c, handle, fail);
        },
    };
}
