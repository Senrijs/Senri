import type { Context } from "./context.ts";
import type { Route } from "./router.ts";
import { suggest } from "./dev/suggest.ts";

export function internalError(c: Context, err: unknown): Response {
    c.error = err;
    return new Response(
        `500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`,
        { status: 500 },
    );
}

export function methodNotAllowed(c: Context, path: string, methods: string): Response {
    return new Response(
        `405 Method Not Allowed: ${c.req.method} ${path}\n${methods} ならあります`,
        { status: 405, headers: { allow: methods } },
    );
}

export function notFound(c: Context, path: string, routes: Route[]): Response {
    let message = `404 Not Found: ${c.req.method} ${path}`;
    const closest = suggest(routes, path);
    if (closest) {
        message += `\nもしかして: ${closest.method} ${closest.path} ?`;
    }
    return new Response(message, { status: 404 });
}

export function nothingReturned(): Response {
    return new Response(
        "500: ミドルウェアが何も返さず、next()もよんでいません",
        { status: 500 },
    );
}
