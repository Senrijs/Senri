// ルートのグループ化。プレフィックスは createRouter のときに決める
// (あとから app.route("/users/:id", router) のように付ける形だと、中のハンドラーで id の型が分からないため)
import type { Handler, Middleware } from "./context.ts";
import { normalizeMethod, splitPattern, type ExtractParams, type Simplify } from "./router.ts";
import { routeHandler, type RouteSchemas, type Validated, type ValidatedParams } from "./validate.ts";
import { senriError } from "./errors.ts";

// プレフィックスとパスをつないだときのパラメーター。"/" を挟むので、"posts" のように "/" なしで書いてもよい
type GroupParams<Prefix extends string, Path extends string> = Simplify<ExtractParams<`${Prefix}/${Path}`>>;

// router.get(path, handler) と、スキーマを付けた router.get(path, { params, query, body }, handler)
type GroupMethod<Prefix extends string, V extends object> = {
    <Path extends string>(path: Path, handler: Handler<GroupParams<Prefix, Path>, V>): void;
    <Path extends string, S extends RouteSchemas>(
        path: Path,
        schemas: S,
        handler: Handler<ValidatedParams<S, GroupParams<Prefix, Path>>, V, Validated<S>>,
    ): void;
};

/**
 * A group of routes under a prefix, created by {@link createRouter} and mounted with `app.route(router)`.
 * Paths are relative to the prefix, and parameters in the prefix are typed in the handlers.
 */
export type Router<Prefix extends string = string, V extends object = any> = {
    /** The prefix given to {@link createRouter}. */
    readonly prefix: Prefix;
    // プレフィックスの下だけで動くミドルウェア。パスを付けると、さらにその下だけ
    /** Adds middleware that runs only under the prefix. With a path, only under that path (relative to the prefix). */
    use(pathOrMw: string | Middleware<V>, mw?: Middleware<V>): void;
    /** Adds a GET route. Same arguments as `app.get`, with the path relative to the prefix. */
    get: GroupMethod<Prefix, V>;
    /** Adds a POST route. */
    post: GroupMethod<Prefix, V>;
    /** Adds a PUT route. */
    put: GroupMethod<Prefix, V>;
    /** Adds a PATCH route. */
    patch: GroupMethod<Prefix, V>;
    /** Adds a DELETE route. */
    delete: GroupMethod<Prefix, V>;
    /** Adds a route for every method, like `app.all`. */
    all: GroupMethod<Prefix, V>;
    /** Adds a HEAD route, like `app.head`. */
    head: GroupMethod<Prefix, V>;
    /** Adds an OPTIONS route, like `app.options`. */
    options: GroupMethod<Prefix, V>;
    /**
     * Adds a route for any method name, or several at once, like `app.on`.
     * Throws right away for `"ALL"`, CONNECT, TRACE, TRACK and invalid names.
     */
    on<Path extends string>(
        method: string | readonly string[],
        path: Path,
        handler: Handler<GroupParams<Prefix, Path>, V>,
    ): void;
    /** Adds a route for any method name, with Standard Schema validation, like `app.on`. */
    on<Path extends string, S extends RouteSchemas>(
        method: string | readonly string[],
        path: Path,
        schemas: S,
        handler: Handler<ValidatedParams<S, GroupParams<Prefix, Path>>, V, Validated<S>>,
    ): void;
    // ルーターの中にルーターをつなげる。中のルーターのプレフィックスは、このルーターからの相対パス
    /**
     * Nests another router. Its prefix is relative to this router's prefix.
     * Its routes are read when the outer router is mounted with `app.route`.
     */
    route(router: Router<string, V>): void;
};

// 登録された順番のまま、app.route のときにアプリへ流し込む
export type GroupEntry =
    | { kind: "route"; method: string; path: string; handler: Handler }
    | { kind: "use"; path: string; mw: Middleware };

const entries = new WeakMap<Router, (prefix: string) => GroupEntry[]>();

export function joinPath(...parts: string[]): string {
    return "/" + parts.flatMap(splitPattern).join("/");
}

// ルーターに登録されたものを、プレフィックスを付けたパスで返す
export function groupEntries(router: Router): GroupEntry[] {
    const list = entries.get(router);
    if (!list) throw senriError("not_router", new TypeError("Not a router from createRouter()"));
    return list("");
}

// V は c.set / c.get で使う変数の型。アプリと同じものを指定する: createRouter<"/admin", Vars>("/admin")
/**
 * Creates a router for routes under `prefix`. Mount it with `app.route(router)`;
 * routes are copied into the app at that point, so add them before mounting.
 *
 * `V` is the app's type; pass the same one as the app: `createRouter<"/admin", Vars>("/admin")`.
 *
 * @example
 * ```ts
 * import { createApp, createRouter } from "@senrijs/senri";
 *
 * const users = createRouter("/users/:id");
 * users.get("/", ({ id }) => `user ${id}`);
 * users.get("/posts", ({ id }) => `posts of ${id}`);
 *
 * const app = createApp();
 * app.route(users);
 * ```
 */
export function createRouter<Prefix extends string, V extends object = Record<string, unknown>>(
    prefix: Prefix,
): Router<Prefix, V> {
    // 子のルーターは、つなげた時点ではなく app.route の時点で中身を読む(あとから足したルートも入る)
    const items: ({ kind: "entry"; entry: GroupEntry } | { kind: "router"; router: Router })[] = [];
    const push = (name: string, path: string, handler: Handler) => {
        items.push({ kind: "entry", entry: { kind: "route", method: name, path, handler } });
    };
    const method = (name: string) =>
        ((path: string, a: Handler | RouteSchemas, b?: Handler) => push(name, path, routeHandler(path, a, b))) as GroupMethod<Prefix, V>;

    const router: Router<Prefix, V> = {
        prefix,
        use(pathOrMw, mw) {
            const path = typeof pathOrMw === "string" ? pathOrMw : "/";
            const fn = typeof pathOrMw === "string" ? mw : pathOrMw;
            if (!fn) throw senriError("no_middleware", `Missing middleware: ${path}`);
            items.push({ kind: "entry", entry: { kind: "use", path, mw: fn as Middleware } });
        },
        get: method("GET"),
        post: method("POST"),
        put: method("PUT"),
        patch: method("PATCH"),
        delete: method("DELETE"),
        all: method("ALL"),
        head: method("HEAD"),
        options: method("OPTIONS"),
        on: ((methods: string | readonly string[], path: string, a: Handler<any> | RouteSchemas, b?: Handler<any>) => {
            const list = typeof methods === "string" ? [methods] : methods;
            if (list.length === 0) throw senriError("no_method", `Missing method: ${path}`);
            const handler = routeHandler(path, a, b);
            for (const m of list) {
                if (m.toUpperCase() === "ALL") throw senriError("on_all", "Use all() for every method");
                // 名前の確認(CONNECT などの拒否)は、ここで先にしておく(app.route まで待たない)
                push(normalizeMethod(m), path, handler);
            }
        }) as Router<Prefix, V>["on"],
        route(child) {
            if (!entries.has(child)) throw senriError("not_router", new TypeError("Not a router from createRouter()"));
            items.push({ kind: "router", router: child });
        },
    };

    const seen = new Set<Router>();
    entries.set(router, (base) => {
        // ルーターが自分自身を(間接的にでも)含んでいると終わらないので止める
        if (seen.has(router)) throw senriError("router_cycle", `Router ${prefix} contains itself`);
        seen.add(router);
        try {
            const here = joinPath(base, prefix);
            return items.flatMap((item) =>
                item.kind === "router"
                    ? entries.get(item.router)!(here)
                    : [{ ...item.entry, path: joinPath(here, item.entry.path) }],
            );
        } finally {
            seen.delete(router);
        }
    });

    return router;
}
