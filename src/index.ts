type Handler = (params: Record<string, string>, req: Request) => Response | Promise<Response>;

type Route = {
    path: string;
    method: string;
    handler: Handler;
};

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

            return route.handler({}, req);
        },
    };
}