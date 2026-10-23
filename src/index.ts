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

function matchPath(pattern: string, path: string): Record<string, string> | null {
    // 1. "/"で分割する
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);

    // 2. 個数が違ったら一致しない
    if (patternParts.length !== pathParts.length) {
        return null;
    }

    // 3. 1個ずつ比較する
    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i]!;
        const actual = pathParts[i]!;

        if (p.startsWith(":")) {
            params[p.slice(1)] = actual;
        } else if (p !== actual) {
            return null;
        }
    }

    return params;
}

function compareRoutes(a: Route, b: Route): number {
    const aParts = a.path.split("/").filter(Boolean);
    const bParts = b.path.split("/").filter(Boolean);
    const len = Math.min(aParts.length, bParts.length);

    for (let i = 0; i < len; i++) {
        const aIsParam = aParts[i]!.startsWith(":");
        const bIsParam = bParts[i]!.startsWith(":");

        // aがパラメータでbがパラメータでない場合、bを優先する
        if (aIsParam && !bIsParam) return 1;
        // aがパラメータでなくbがパラメータの場合、aを優先する
        if (!aIsParam && bIsParam) return -1;
    }
    return 0;
}

export function createApp() {
    const routes: Route[] = [];

    return {
        get(path: string, handler: Handler) {
            routes.push({ path, method: "GET", handler });
            routes.sort(compareRoutes);
        },

        async fetch(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const path = url.pathname;

            for (const route of routes) {
                if (route.method !== req.method) continue;

                const params = matchPath(route.path, path);
                if (params === null) continue;

                const result = await route.handler(params, req);
                return toResponse(result);
            }

            return new Response("Not found", { status: 404 });
        },
    };
}