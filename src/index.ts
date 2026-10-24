type HandlerResult = Response | string | object;

type Handler = (
    params: Record<string, string>,
    c: Context,
) => HandlerResult | Promise<HandlerResult>;

type Route = {
    path: string;
    method: string;
    handler: Handler;
};

export class Context {
    req: Request;
    #status = 200;
    #headers =new Headers();

    constructor(req: Request) {
        this.req = req;
    }

    status(code: number) {
        this.#status = code;
        return this;
    }

    header(name: string, value: string) {
        this.#headers.set(name, value);
        return this;
    }

    json(data: unknown, status?:number): Response {
        this.#headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify(data), {
            status: status ?? this.#status,
            headers: this.#headers,
        });
    }

    text(body: string, status?: number): Response {
        return new Response(body, {
            status: status ?? this.#status,
            headers: this.#headers,
        });
    }

    toResponse(value: HandlerResult): Response {
        if (value instanceof Response) {
            return value;
        } 
        if (typeof value === "string") {
            return this.text(value);
        }
        return this.json(value);
    }
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

// 2つの文字列が、何回の「追加・削除・置き換え」で同じになるかを数える
function distance(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i]![j] = Math.min(
            dp[i - 1]![j]! + 1,
            dp[i]![j - 1]! + 1,
            dp[i - 1]![j - 1]! + cost,
        );
        }
    }
    return dp[a.length]![b.length]!;
}

export function createApp() {
    const routes: Route[] = [];

    function add() {
        return (method: string, path: string, handler: Handler) => {
            routes.push({ path, method, handler });
            routes.sort(compareRoutes);
        };
    }

    return {
        get(path: string, handler: Handler) {
            add()("GET", path, handler);
        },

        post(path: string, handler: Handler) {
            add()("POST", path, handler);
        },

        delete(path: string, handler: Handler) {
            add()("DELETE", path, handler);
        },

        routes(table: Record<string, Handler>) {
            for (const [key, handler] of Object.entries(table)) {
                const [method, path] = key.split(" ");
                if (!method || !path) {
                    throw new Error(`ルートの書き方が違います: "${key}"\n例: "GET /hello"`);
                }

                add()(method.toUpperCase(), path, handler);
            }
        },

        async fetch(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const path = url.pathname;

            for (const route of routes) {
                if (route.method !== req.method) continue;

                const params = matchPath(route.path, path);
                if (params === null) continue;

                const c = new Context(req);
                const result = await route.handler(params, c);
                return c.toResponse(result);
            }

            const samePath = routes.filter((r) => matchPath(r.path, path) !== null);
            if (samePath.length > 0) {
                const methods = samePath.map((r) => r.method).join(", ");
                return new Response(
                    `405 Method Not Allowed: ${req.method} ${path}\n${methods} ならあります`,
                    { status: 405, headers: { allow: methods } },
                );
            }

            let closest: Route | null = null;
            let best = Infinity;
            for (const r of routes) {
                const d = distance(r.path, path);
                if (d < best) {
                    closest = r;
                    best = d;
                }
            }

            let message = `404 Not Found: ${req.method} ${path}`;
            if (closest && best <= 3) {
                message += `\nもしかして: ${closest.method} ${closest.path} ?`;
            }

            return new Response(message, { status: 404 });
        },
    };
}