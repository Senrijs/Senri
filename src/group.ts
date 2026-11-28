// ルートのグループ化。プレフィックスは createRouter のときに決める
// (あとから app.route("/users/:id", router) のように付ける形だと、中のハンドラーで id の型が分からないため)
import type { CheckUseVars, Handler, Middleware, MiddlewareProvides, MiddlewareVars, VarsRoute, WithVars } from "./context.ts";
import { normalizeMethod, splitPattern, type ExtractParams, type Simplify } from "./router.ts";
import { routeHandler, type CheckParamTypes, type RouteInfoOf, type RouteMiddleware, type RouteOptions, type ValidatedParams } from "./validate.ts";
import { checkUse, type TableOptions } from "./routes.ts";
import { senriError } from "./errors.ts";

// プレフィックスとパスをつないだときのパラメーター。"/" を挟むので、"posts" のように "/" なしで書いてもよい
/** The path parameters of a route in a router: the prefix's and the path's. */
export type RouterParams<Prefix extends string, Path extends string> = Simplify<ExtractParams<`${Prefix}/${Path}`>>;

// router.get(path, handler) と、スキーマやミドルウェアを付けた router.get(path, { use, params, query, body }, handler)
// X は createRouter(prefix, { use }) のミドルウェアが「必ず入れる」と宣言した変数
/** A route method of a {@link Router} (`router.get`, `router.post`, ...). Paths are relative to the prefix. */
export type RouterMethod<Prefix extends string, V extends object, X extends object = {}> = {
    <Path extends string>(path: Path, handler: Handler<RouterParams<Prefix, Path>, V, VarsRoute<X>>): void;
    <Path extends string, S extends RouteOptions>(
        path: Path,
        options: S & NoInfer<CheckParamTypes<S, RouterParams<Prefix, Path>>> & NoInfer<CheckUseVars<S["use"], V, X>>,
        handler: Handler<
            ValidatedParams<S, RouterParams<Prefix, Path>>,
            WithVars<V, MiddlewareVars<S["use"]>>,
            RouteInfoOf<S, RouterParams<Prefix, Path>, X>
        >,
    ): void;
};

/**
 * A group of routes under a prefix, created by {@link createRouter} and mounted with `app.route(router)`.
 * Paths are relative to the prefix, and parameters in the prefix are typed in the handlers.
 * `X` is the variables that the router's middleware (`createRouter(prefix, { use })`) declare they always set.
 */
export type Router<Prefix extends string = string, V extends object = any, X extends object = {}> = {
    /** The prefix given to {@link createRouter}. */
    readonly prefix: Prefix;
    // プレフィックスの下だけで動くミドルウェア。パスを付けると、さらにその下だけ
    /**
     * Adds middleware that runs only under the prefix. With a path, only under that path (relative to the prefix).
     * `use("/x/*", mw)` means the same as `use("/x", mw)`. Any other `*` in the path throws when the router is mounted.
     */
    use(pathOrMw: string | Middleware<V>, mw?: Middleware<V>): void;
    /** Adds a GET route. Same arguments as `app.get`, with the path relative to the prefix. */
    get: RouterMethod<Prefix, V, X>;
    /** Adds a POST route. */
    post: RouterMethod<Prefix, V, X>;
    /** Adds a PUT route. */
    put: RouterMethod<Prefix, V, X>;
    /** Adds a PATCH route. */
    patch: RouterMethod<Prefix, V, X>;
    /** Adds a DELETE route. */
    delete: RouterMethod<Prefix, V, X>;
    /** Adds a route for every method, like `app.all`. */
    all: RouterMethod<Prefix, V, X>;
    /** Adds a HEAD route, like `app.head`. */
    head: RouterMethod<Prefix, V, X>;
    /** Adds an OPTIONS route, like `app.options`. */
    options: RouterMethod<Prefix, V, X>;
    /**
     * Adds a route for any method name, or several at once, like `app.on`.
     * Throws right away for `"ALL"`, CONNECT, TRACE, TRACK and invalid names.
     */
    on<Path extends string>(
        method: string | readonly string[],
        path: Path,
        handler: Handler<RouterParams<Prefix, Path>, V, VarsRoute<X>>,
    ): void;
    /** Adds a route for any method name, with Standard Schema validation or middleware, like `app.on`. */
    on<Path extends string, S extends RouteOptions>(
        method: string | readonly string[],
        path: Path,
        options: S & NoInfer<CheckParamTypes<S, RouterParams<Prefix, Path>>> & NoInfer<CheckUseVars<S["use"], V, X>>,
        handler: Handler<
            ValidatedParams<S, RouterParams<Prefix, Path>>,
            WithVars<V, MiddlewareVars<S["use"]>>,
            RouteInfoOf<S, RouterParams<Prefix, Path>, X>
        >,
    ): void;
    // ルーターの中にルーターをつなげる。中のルーターのプレフィックスは、このルーターからの相対パス
    /**
     * Nests another router. Its prefix is relative to this router's prefix.
     * Its routes are read when the outer router is mounted with `app.route`.
     */
    route(router: Router<any, V, any>): void;
};

// 登録された順番のまま、app.route のときにアプリへ流し込む
export type GroupEntry =
    | { kind: "route"; method: string; path: string; handler: Handler; use?: RouteMiddleware | undefined }
    | { kind: "use"; path: string; mw: Middleware };

const entries = new WeakMap<Router<any, any, any>, (prefix: string) => GroupEntry[]>();

export function joinPath(...parts: string[]): string {
    return "/" + parts.flatMap(splitPattern).join("/");
}

// ルーターに登録されたものを、プレフィックスを付けたパスで返す
export function groupEntries(router: Router<any, any, any>): GroupEntry[] {
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
 * `options.use` adds middleware to every route of the router (and of routers nested in it), like
 * `defineRoutes(prefix, { use })`: it runs only when one of those routes matches, after the app's middleware and
 * before each route's own `use`. Variables it declares it always sets (`Middleware<V, { vars }>`) are typed in
 * `c.get()` without `undefined`. `router.use(mw)`, by contrast, runs for every request under the prefix and adds no types.
 * Throws if `use` is not an array of functions.
 *
 * @example
 * ```ts
 * import { createApp, createRouter } from "@senrijs/senri";
 *
 * const users = createRouter("/users/:id");
 * users.get("/", ({ id }) => `user ${id}`);
 * users.get("/posts", ({ id }) => `posts of ${id}`);
 *
 * const admin = createRouter("/admin", { use: [requireUser] });
 * admin.get("/me", (_, c) => c.get("user").name);
 *
 * const app = createApp();
 * app.route(users);
 * app.route(admin);
 * ```
 */
// options.use は、このルーターの全部のルートに付けるミドルウェア(defineRoutes(prefix, { use }) と同じく、ルートのミドルウェアとして動く)
export function createRouter<Prefix extends string, V extends object = Record<string, unknown>, const O extends TableOptions = {}>(
    prefix: Prefix,
    options?: O & TableOptions & NoInfer<CheckUseVars<O["use"], V>>,
): Router<Prefix, WithVars<V, MiddlewareVars<O["use"]>>, MiddlewareProvides<O["use"]>> {
    checkUse(options?.use, `createRouter("${prefix}")`);
    const own = options?.use ?? [];
    // 子のルーターは、つなげた時点ではなく app.route の時点で中身を読む(あとから足したルートも入る)
    const items: ({ kind: "entry"; entry: GroupEntry } | { kind: "router"; router: Router<any, any, any> })[] = [];
    const push = (name: string, path: string, handler: Handler, use?: RouteMiddleware | undefined) => {
        items.push({ kind: "entry", entry: { kind: "route", method: name, path, handler, use } });
    };
    // router.get(path, handler) か router.get(path, { use, params, query, body }, handler)
    const parts = (path: string, a: Handler | RouteOptions, b?: Handler): [Handler, (RouteMiddleware | undefined)?] => {
        if (typeof a === "function") return [a];
        const { use, ...schemas } = a;
        checkUse(use, path);
        return [routeHandler(path, schemas, b), use];
    };
    const method = (name: string) =>
        ((path: string, a: Handler | RouteOptions, b?: Handler) => push(name, path, ...parts(path, a, b))) as unknown as RouterMethod<Prefix, any, any>;

    const router: Router<Prefix, any, any> = {
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
        on: ((methods: string | readonly string[], path: string, a: Handler<any> | RouteOptions, b?: Handler<any>) => {
            const list = typeof methods === "string" ? [methods] : methods;
            if (list.length === 0) throw senriError("no_method", `Missing method: ${path}`);
            const route = parts(path, a, b);
            for (const m of list) {
                if (m.toUpperCase() === "ALL") throw senriError("on_all", "Use all() for every method");
                // 名前の確認(CONNECT などの拒否)は、ここで先にしておく(app.route まで待たない)
                push(normalizeMethod(m), path, ...route);
            }
        }) as unknown as Router<Prefix, any, any>["on"],
        route(child) {
            if (!entries.has(child)) throw senriError("not_router", new TypeError("Not a router from createRouter()"));
            items.push({ kind: "router", router: child });
        },
    };

    const seen = new Set<Router<any, any, any>>();
    entries.set(router, (base) => {
        // ルーターが自分自身を(間接的にでも)含んでいると終わらないので止める
        if (seen.has(router)) throw senriError("router_cycle", `Router ${prefix} contains itself`);
        seen.add(router);
        try {
            const here = joinPath(base, prefix);
            const list = items.flatMap((item) =>
                item.kind === "router"
                    ? entries.get(item.router)!(here)
                    : [{ ...item.entry, path: joinPath(here, item.entry.path) }],
            );
            // createRouter(prefix, { use }) のミドルウェアを、中のルーターのものも含めて、各ルートの use の前に付ける
            if (own.length === 0) return list;
            return list.map((entry) => (entry.kind === "route" ? { ...entry, use: [...own, ...(entry.use ?? [])] } : entry));
        } finally {
            seen.delete(router);
        }
    });

    return router as Router<Prefix, WithVars<V, MiddlewareVars<O["use"]>>, MiddlewareProvides<O["use"]>>;
}
