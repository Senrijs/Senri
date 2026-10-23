type HandlerResult = Response | string | object;

type Handler = (
    params: Record<string, string>,
     req: Request
) => HandlerResult | Promise<HandlerResult>;

type Route = {
    path: string;
    method: string;
    handler: Handler;
};

function toResponse(value: HandlerResult): Response {
    if (value instanceof Response) {
        return value;
    }
    if (typeof value === "string") {
        return new Response(value);
    }
    return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
    });
}

export function createApp() {
    const routes: Route[] = [];

    return {
        get(path: string, handler: Handler) {
            routes.push({ path, method: "GET", handler });
        },

        async fetch(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const path = url.pathname;

            const route = routes.find(r => r.path === path && r.method === req.method);
            if (!route) {
                return new Response("Not found", { status: 404 });
            }

            const result = await route.handler({}, req);
            return toResponse(result);
        },
    };
}