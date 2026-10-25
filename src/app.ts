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

export function createApp() {
    const routes: Route[] = [];
    const middlewares: Middleware[] = [];
    let onError: ErrorHandler = defaultOnError;
    let notFound: NotFoundHandler = defaultNotFound(routes);

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

            const handle = async (): Promise<Response> => {
                const path = new URL(req.url).pathname;

                for (const route of routes) {
                    if (route.method !== req.method) continue;
                    const params = matchPath(route.path, path);
                    if (params === null) continue;
                    try {
                        const result = await route.handler(params, c);
                        return c.toResponse(result);
                    } catch (err) {
                        return fail(err);
                    }
                }

                const samePath = routes.filter((r) => matchPath(r.path, path) !== null);
                if (samePath.length > 0) {
                    return fail(methodNotAllowed(c, path, samePath.map((r) => r.method).join(", ")));
                }

                c.status(404);
                return c.toResponse(await notFound(c));
            };

            return compose(middlewares, c, handle, fail);
        },
    };
}
