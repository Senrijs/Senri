import { Context, type ExecutionContext, type Handler, type HandlerResult, type Middleware } from "./context.ts";
import {
    allowedMethods,
    checkParamNames,
    checkPathSyntax,
    middlewarePath,
    normalizeMethod,
    routeShape,
    splitPattern,
    startsWithSegments,
    type ExtractParams,
    type RouteTable,
    type Route,
    type Simplify,
} from "./router.ts";
import { compose, type Layer } from "./compose.ts";
import { createMatcher } from "./matcher.ts";
import { routeHandler, type RouteSchemas, type StandardSchemaV1, type Validated, type ValidatedParams } from "./validate.ts";
import { groupEntries, joinPath, type GroupEntry, type Router } from "./group.ts";
import { isEndpoint, type TableShape } from "./routes.ts";
import { attachBodyCap, capBody, checkMaxBodySize, declaredLength, tooLargeResponse, type BodyCap } from "./body-cap.ts";
import {
    defaultNotFound,
    defaultOnError,
    checkQueryRequest,
    handleError,
    HttpError,
    markConversionError,
    methodNotAllowed,
    notFoundResponse,
    senriError,
    type ErrorHandler,
    type NotFoundHandler,
} from "./errors.ts";

// リクエストをどう処理するかの結論。ミドルウェアより前に1回だけ決める
/**
 * How the app will handle a request, decided once before middleware runs.
 * Part of the contract with `@senrijs/senri/dev` ({@link AppCore}); app code does not normally use it.
 */
export type Resolved =
    | { kind: "route"; route: Route; params: Record<string, string> }
    | { kind: "options"; allow: string }
    | { kind: "methodNotAllowed"; allow: string }
    | { kind: "notFound" }
    | { kind: "notImplemented" }
    | { kind: "badRequest"; error: unknown };

// 扱わないメソッド。ルートがあってもなくても 501 にする(app.all() でも受けない)
const NOT_IMPLEMENTED = new Set(["CONNECT", "TRACE", "TRACK"]);

// app.get(path, handler) と、スキーマを付けた app.get(path, { params, query, body }, handler)
/** A route method of an app (`app.get`, `app.post`, ...): `(path, handler)` or `(path, schemas, handler)`. */
export type RouteMethod<V extends object> = {
    <Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>): void;
    <Path extends string, S extends RouteSchemas>(
        path: Path,
        schemas: S,
        handler: Handler<ValidatedParams<S, Simplify<ExtractParams<Path>>>, V, Validated<S>>,
    ): void;
};

/** `app.on`: a route for any method name, or several at once. */
export type OnMethod<V extends object> = {
    <Path extends string>(method: string | readonly string[], path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>): void;
    <Path extends string, S extends RouteSchemas>(
        method: string | readonly string[],
        path: Path,
        schemas: S,
        handler: Handler<ValidatedParams<S, Simplify<ExtractParams<Path>>>, V, Validated<S>>,
    ): void;
};

// app.route(prefix, app) でつなげるように、アプリに登録されたものを横に置いておく
const appEntries = new WeakMap<object, () => GroupEntry[]>();

// Node のアダプターに渡す、アプリの中身。開発モードのアプリは持たない(app.fetch の道を通す)
const nodeCores = new WeakMap<object, AppCore>();
export const nodeCoreOf = (app: object): AppCore | undefined => nodeCores.get(app);

// app.route(prefix, app) に渡せるもの(createApp() で作ったアプリ)
/** An app that can be mounted with `app.route(prefix, app)`. Only apps from {@link createApp} are accepted at runtime. */
export type MountableApp = {
    /** The registered routes, in registration order. */
    routeList(): { method: string; path: string }[];
};

// createApp() が返すアプリ
/**
 * The app returned by {@link createApp}.
 *
 * `V` is the app's type: either the variables used with `c.set` / `c.get` (`{ user: User }`),
 * or `{ Bindings: Env; Variables: { user: User } }` to also type `c.env` on Cloudflare Workers.
 */
export type App<V extends object = Record<string, unknown>> = {
    /**
     * Adds middleware. Middleware runs in registration order.
     * With a path (`app.use("/admin", mw)`), it runs only for that path and below, compared by segment
     * (`/admin` does not match `/administrator`; `:param` segments match any segment).
     * `app.use("/admin/*", mw)` means the same as `app.use("/admin", mw)`, so it also runs for `/admin` itself.
     * Throws if the middleware is missing, or if the path has a `*` anywhere other than as the whole last segment.
     */
    use(pathOrMw: string | Middleware<V>, mw?: Middleware<V>): void;
    /**
     * Replaces the error handler. It receives anything thrown by middleware or handlers, except `c.notFound()`.
     * Before it is called, the status is set from an {@link HttpError} (status and headers) or to 500.
     * Without development mode, the default returns the `HttpError` message, or `"500 Internal Server Error"` for other errors.
     */
    onError(handler: ErrorHandler<V>): void;
    /**
     * Replaces the handler for requests that match no route, and for `c.notFound()`.
     * The status is already set to 404 when it is called.
     */
    notFound(handler: NotFoundHandler<V>): void;
    /**
     * Adds a GET route: `app.get(path, handler)`, or `app.get(path, { params, query, body }, handler)` to validate
     * with Standard Schema first. Path parameters (`/users/:id`) are typed from the path.
     * There are no optional or regular expression parameters: a name containing `?`, `+`, `{`, `}`, `(`, `)`, `[`, `]`, `|`, `:`
     * or a space throws (`:id?`, `:id{[0-9]+}`). Check the value in the handler or with a schema.
     *
     * A `*` as the whole last segment (`/files/*`) matches that path and everything below it: `/files`, `/files/a`, `/files/a/b`.
     * The rest of the path is in the `"*"` parameter (`"a/b"`, or `""` for `/files`). Any other `*` throws.
     * - Static routes come first, then parameters, then wildcards, whatever the registration order.
     * - Wildcard routes do not count for 405 or the automatic OPTIONS response: a request to a path that only a wildcard
     *   route matches, with a method it does not have, gets 404. Register the method to answer it (`app.options`, `app.all`).
     * - Each segment of the value is decoded once; do not decode it again. `%2F` is a 400 before routing, so every `/` in the
     *   value separates segments. It can still contain `\`, `:` or NUL (`..%5C..` gives `..\..`), so it is not safe to use as
     *   a file path. To serve files, use `serveStatic` from `@senrijs/senri/static`.
     *
     * @example
     * ```ts
     * import { createApp } from "@senrijs/senri";
     *
     * const app = createApp();
     * app.get("/users/:id", ({ id }) => ({ id }));
     * app.get("/docs/*", ({ "*": page }) => `page: ${page}`);
     * ```
     */
    get: RouteMethod<V>;
    /** Adds a POST route. Same arguments as {@link App.get}. */
    post: RouteMethod<V>;
    /** Adds a PUT route. Same arguments as {@link App.get}. */
    put: RouteMethod<V>;
    /** Adds a PATCH route. Same arguments as {@link App.get}. */
    patch: RouteMethod<V>;
    /** Adds a DELETE route. Same arguments as {@link App.get}. */
    delete: RouteMethod<V>;
    /**
     * Adds a HEAD route. Without one, HEAD requests use the GET route.
     * For HEAD requests, the body of the route's response is dropped.
     */
    head: RouteMethod<V>;
    /**
     * Adds an OPTIONS route. Without one (and without a matching `all` route),
     * OPTIONS requests to a known path get 204 with an `Allow` header.
     */
    options: RouteMethod<V>;
    /**
     * Adds a route for every method. A route registered for the request's method takes precedence.
     * CONNECT, TRACE and TRACK are always answered with 501.
     */
    all: RouteMethod<V>;
    /**
     * Adds a route for any method name, or several at once: `app.on(["PUT", "PATCH"], path, handler)`.
     * Names are upper-cased. Throws for `"ALL"` (use {@link App.all}), CONNECT, TRACE, TRACK and invalid names.
     */
    on: OnMethod<V>;
    // 0.3.0 で、2 つあった型の書き方を 1 つにした(RouteTable も defineRoutes() の表と同じ形)
    // キーの書き方は型で確かめる。その場で書いたハンドラーには、このアプリの型(c.get() など)が付く
    /**
     * Adds routes from a table keyed by `"METHOD /path"`: `app.routes({ "GET /hello": () => "hi" })`, or a table
     * made with {@link defineRoutes} (including routes with schemas or middleware made with {@link endpoint}).
     * Path parameters are typed from each key. The same checks as {@link App.get} apply to each route.
     */
    routes<const T extends object>(table: T & NoInfer<RouteTable<T, V>>): void;
    /**
     * Mounts a router from {@link createRouter}, or another app under a prefix: `app.route("/api", api)`.
     * What is registered at this point is copied into this app.
     * A mounted app's `onError` / `notFound` are not used; this app's are.
     */
    route(routerOrPrefix: Router<string, V> | string, child?: MountableApp): void;
    /**
     * The registered middleware, in registration order.
     * `name` is the function's name, or `anonymous#N` (with `anonymous: true`) for unnamed functions.
     */
    middlewareList(): { name: string; path: string | null; anonymous: boolean }[];
    /** The registered routes, in registration order. */
    routeList(): { method: string; path: string }[];
    /**
     * Handles a request. Pass it to your runtime (`Bun.serve({ fetch: app.fetch })`, `Deno.serve(app.fetch)`)
     * or `export default app` on Cloudflare Workers.
     *
     * @param info The runtime's second argument (Bun's server, Deno's info, or `env` on Workers). Used for the client address and `c.env`.
     * @param ctx Cloudflare Workers' execution context, available as `c.executionCtx`.
     */
    fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response>;
};

/** Options for {@link createApp}. */
export type AppOptions = {
    // 開発モード。@senrijs/senri/dev の devtools() を渡す: createApp({ dev: devtools() })
    // 本体は開発用のコード(エラーページ・ダッシュボードなど)を一切 import しない。渡さなければバンドルにも入らない
    /**
     * Development mode. Pass `devtools()` from `@senrijs/senri/dev`: `createApp({ dev: devtools() })`.
     * The core imports no development code, so without it none is bundled.
     */
    dev?: DevHooks | undefined;
    // 本文を全部読む関数(c.body()・ルートの body のスキーマ・c.req.json() / text() / formData() / arrayBuffer())の上限
    // 読んだときだけ効く。超えたら 413。ルートの bodyLimit() / uploadLimit() / multipart() は、自分の上限で置き換える
    /**
     * The default limit on the request body, in bytes, for code that reads the whole body: `c.body()`, a route's `body`
     * schema, and `c.req.json()` / `text()` / `formData()` / `arrayBuffer()`. Default 1 MiB; `Infinity` removes it.
     *
     * It applies only when the body is read: routes that do not read it are not affected. Over the limit, reading fails
     * and the response is 413 (even if the handler catches the error). A body with a larger `Content-Length` is refused
     * without reading it. On a route, `bodyLimit()` (and `uploadLimit()`, which uses it) and `multipart()` replace it
     * with their own limits, so a route can accept more. A negative or non-numeric value throws a `RangeError`.
     */
    maxBodySize?: number;
};

// 開発用のフック。@senrijs/senri/dev の devtools() が作る(本体が知っているのは、この形だけ)
/**
 * Development hooks, created by `devtools()` from `@senrijs/senri/dev`.
 * The core only knows this shape; app code does not normally implement it.
 */
export type DevHooks = {
    // createApp() の最後に1回だけ呼ぶ。アプリの中身(core)を受け取って、開発モードの処理を返す
    /** Called once at the end of {@link createApp} with the app's internals. */
    install(core: AppCore): DevInstalled;
};

// 開発モードで使う、アプリの中身
/** The app's internals, passed to {@link DevHooks.install}. Used by `@senrijs/senri/dev`; app code does not normally use it. */
export type AppCore = {
    /** The app being created. */
    app: App<any>;
    // ルートを決める / かかるミドルウェアを集める / いちばん内側の処理(本番の fetch と同じもの)
    /** Decides how the request is handled (route, 404, 405, ...). `method` defaults to `c.req.method`. */
    resolve(c: Context, method?: string): Resolved;
    // resolved を渡すと、当たったルートに付けたミドルウェア(endpoint() / defineRoutes() の use)も後ろに足す
    /** The middleware that applies to the request; with `resolved`, followed by the matched route's own middleware. */
    layers(c: Context, resolved?: Resolved): Layer[];
    /** The innermost step after all middleware (the same as in production). */
    inner(c: Context, resolved: Resolved): Response | Promise<Response>;
    // いまの onError を通して、例外をレスポンスにする
    /** Turns an error into a response through the current `onError`. */
    fail(err: unknown, c: Context): Promise<Response>;
    // 登録されたルート(登録順)
    /** The registered routes, in registration order. */
    routes(): readonly Route[];
    // app.notFound() で差し替えていない(既定の 404 のまま)か。Node のアダプターが、Response を作らずに 404 を返すのに使う
    /** Whether the 404 handler is still the default one (not replaced with `app.notFound()`). */
    defaultNotFound(): boolean;
    // 本文の既定の上限(createApp({ maxBodySize }))。Infinity なら上限なし
    /** The default body limit in bytes (`createApp({ maxBodySize })`); `Infinity` for none. */
    maxBodySize: number;
    // 本文があれば、c.req を上限つきの Request にして、上限の箱を返す(本文がないか、上限がなければ undefined)
    // 呼んだ側は、応答のあとで exceeded を見て、超えていたら 413 にする
    /**
     * If the request has a body and there is a default limit, replaces `c.req` with a Request whose body is counted
     * against it, and returns the per-request limit. The caller answers 413 if `exceeded` is set after the response.
     */
    capBody(c: Context): BodyCap | undefined;
};

/** What {@link DevHooks.install} returns. Used by the core; app code does not normally use it. */
export type DevInstalled = {
    // app.fetch の代わり(計測・エラーページ・ダッシュボードの記録など)
    /** Used instead of the production `app.fetch`. */
    fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response>;
    // 既定の onError / notFound(app.onError / app.notFound で替えたら、そちらを使う)
    /** The default error handler in development mode. `app.onError` replaces it. */
    onError: ErrorHandler;
    /** The default not-found handler in development mode. `app.notFound` replaces it. */
    notFound: NotFoundHandler;
    // ルートを登録する前に確かめる(/_senri の予約、スキーマの書き間違い)
    /** Checks a route before it is registered; throws to reject it. */
    checkRoute(method: string, path: string, schemas: RouteSchemas | undefined): void;
    // 登録時のエラーに、日本語の説明を付ける
    /** Adds an explanation to an error thrown while registering, and returns the error to throw. */
    explain(err: unknown): unknown;
    // endpoint({ response }) のルートで、ハンドラーの戻り値をスキーマで確かめるハンドラーにする
    /** Wraps the handler of a route with a `response` schema to check its return value. */
    watchResponse?(route: string, schema: StandardSchemaV1, handler: Handler): Handler;
};

// 0.1 の createApp({ dev: true }) は使えなくなった。どう書き換えるかを案内する
const DEV_TRUE = `createApp({ dev: true }) is no longer supported. Use devtools() from "@senrijs/senri/dev".

  import { createApp } from "@senrijs/senri";
  import { devtools } from "@senrijs/senri/dev";

  const app = createApp({ dev: devtools() });`;

// V はアプリの型。c.set / c.get で使う変数の型(createApp<{ user: User }>())か、
// Workers の env も含めた形(createApp<{ Bindings: Env; Variables: { user: User } }>())で指定する(src/context.ts)
/**
 * Creates an app.
 *
 * `V` is the type of the variables used with `c.set` / `c.get` (`createApp<{ user: User }>()`),
 * or `{ Bindings: Env; Variables: {...} }` to also type `c.env` on Cloudflare Workers.
 * Throws if `options.dev` is `true` (0.1 style); pass `devtools()` from `@senrijs/senri/dev` instead.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 *
 * const app = createApp<{ user: string }>();
 *
 * app.use("/admin", async (c, next) => {
 *     c.set("user", "alice");
 *     await next();
 * });
 * app.get("/admin/users/:id", ({ id }, c) => ({ id, by: c.get("user") }));
 * app.post("/echo", async (_, c) => c.json(await c.body(), 201));
 * ```
 */
export function createApp<V extends object = Record<string, unknown>>(options: AppOptions = {}): App<V> {
    if ((options.dev as unknown) === true) throw senriError("dev_true", DEV_TRUE);
    const maxBodySize = checkMaxBodySize(options.maxBodySize);
    const routes: Route[] = [];
    const matcher = createMatcher();
    // prefix が null なら全部のリクエストで動く。["admin"] なら /admin とその下だけ
    // anonymous: 無名の関数だった(名前を anonymous#番号 にした)。ダッシュボードで「名前を付けると出る」と案内する
    const middlewares: { name: string; anonymous: boolean; path: string | null; prefix: string[] | null; mw: Middleware<V> }[] = [];
    // 開発モードの処理。createApp の最後に devtools().install() で入る(渡さなければ undefined のまま)
    let devHooks: DevInstalled | undefined;
    let onError: ErrorHandler<V> = defaultOnError;
    let notFound: NotFoundHandler<V> = defaultNotFound;

    // 登録時のエラーに、開発モードでは日本語の説明を付ける
    function guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
        return (...args) => {
            try {
                fn(...args);
            } catch (err) {
                throw devHooks ? devHooks.explain(err) : err;
            }
        };
    }

    function method(name: string): RouteMethod<V> {
        return guard((path: string, a: Handler | RouteSchemas, b?: Handler) =>
            add(name, path, routeHandler(path, a, b), typeof a === "function" ? undefined : a),
        ) as RouteMethod<V>;
    }

    // use: このルートだけのミドルウェア(endpoint() / defineRoutes() の use)
    function add(rawMethod: string, path: string, handler: Handler, schemas?: RouteSchemas, use?: readonly Middleware[]) {
        // app.all() の印の "ALL" だけはそのまま。ほかは名前を確かめて大文字にする
        const method = rawMethod === "ALL" ? rawMethod : normalizeMethod(rawMethod);
        devHooks?.checkRoute(method, path, schemas);
        const segments = splitPattern(path);
        checkParamNames(path, segments);
        checkPathSyntax(path, segments);

        // 同じメソッド + 同じ形のパスがあったら、あとから登録したほうは絶対に呼ばれないのでエラーにする
        const shape = routeShape(segments);
        const dup = routes.find((r) => r.method === method && routeShape(r.segments) === shape);
        if (dup) throw senriError("route_duplicate", `Duplicate route: ${method} ${path} (already: ${dup.method} ${dup.path})`);

        const paramNames = segments.filter((s) => s.startsWith(":") || s === "*").map((s) => (s === "*" ? s : s.slice(1)));
        const route: Route = { path, segments, paramNames, method, handler };
        // 名前は app.use() と同じく関数の名前(無名なら anonymous)。登録順(order)は持たない(ダッシュボードの集計は app.use() のものだけ)
        if (use && use.length > 0) route.use = use.map((mw) => ({ name: mw.name || "anonymous", mw }));
        // routes は一覧(routeList や 404 の「もしかして」)用で、登録順。探すのは matcher(Trie)で行う
        routes.push(route);
        matcher.add(route);
    }

    // マッチしたルートのパラメーターを、ルートごとの名前で組み立てる
    function paramsOf(route: Route, values: string[]): Record<string, string> {
        const params: Record<string, string> = {};
        const names = route.paramNames;
        for (let i = 0; i < names.length; i++) params[names[i]!] = values[i]!;
        return params;
    }

    // method: Node のアダプターは、Request を作らずに渡す
    function resolve(c: Context, method: string = c.req.method): Resolved {
        let path: string;
        try {
            path = c.path;
        } catch (error) {
            // エンコードが不正(HttpError 400)。ミドルウェアは動かしてから返す
            return { kind: "badRequest", error };
        }
        if (NOT_IMPLEMENTED.has(method)) return { kind: "notImplemented" };

        // 近道: パラメーターのないルートにぴったり合い、メソッドも合えば、それがいちばん優先される
        // (この場合はパスを分割しなくて済む)
        const exact = matcher.staticLeaf(path);
        if (exact) {
            for (const route of exact) {
                if (route.method === method) return { kind: "route", route, params: {} };
            }
        }

        // c.path が読めたので、ここで分割に失敗することはない
        const segments = c.segments;
        const find = (m: string): Resolved | undefined => {
            const hit = matcher.first(segments, m);
            return hit ? { kind: "route", route: hit.route, params: paramsOf(hit.route, hit.values) } : undefined;
        };

        // 1. メソッドが合うもの → 2. HEAD なら GET → 3. all の順に、優先順位の高いルートから探す
        const hit = find(method) ?? (method === "HEAD" ? find("GET") : undefined) ?? find("ALL");
        if (hit) return hit;

        // どれもなければ、パスが合うルートを全部集めて 404 か 405 かを決める(ワイルドカードのルートは数えない)
        const matched = matcher.match(segments);
        if (matched.length === 0) return { kind: "notFound" };
        const allow = allowedMethods(matched.flatMap((x) => x.leaf));
        return method === "OPTIONS" ? { kind: "options", allow } : { kind: "methodNotAllowed", allow };
    }

    // 本文があれば、c.req を上限つきの Request にする(本文のない GET などでは何もしない。Request も作らない)
    // Bun の requestIP は元の Request で聞くので、Context には元のものを渡したまま、c.req だけ差し替える
    function capRequest(c: Context): BodyCap | undefined {
        if (maxBodySize === Infinity) return undefined;
        const req = c.req;
        // GET と HEAD は本文を持てない。何も見ずに終わる
        const method = req.method;
        if (method === "GET" || method === "HEAD") return undefined;
        // Content-Length が上限以下なら、包まない(ランタイムは宣言より長い本文を受け取らないので、数えなくてよい)
        // - 包むと、ランタイムが本文を速く読む道を使えなくなる(小さい JSON の POST が数倍遅くなった)
        // - req.body も見ない。見るだけで、あとの req.text() などが遅くなる(Bun で +1.8 µs、Deno で +7.7 µs)
        // 包むのは、Content-Length のない本文(チャンク転送や HTTP/2)と、上限を超える Content-Length(読んだときに 413)だけ
        const declared = declaredLength(req.headers.get("content-length"));
        if (declared !== null && declared <= maxBodySize) return undefined;
        // body が無いもの(null のほか、本物でない Request で undefined)は、本文なし
        const source = req.body;
        if (!source) return undefined;
        const cap = attachBodyCap(c, { max: maxBodySize, exceeded: false });
        const body = capBody(source, cap, declared);
        c.req = new Request(req, { body, duplex: "half" } as RequestInit);
        return cap;
    }

    // ミドルウェアがないときに毎回配列を作らないよう、共有の空配列を返す(中身は変えない)
    const NO_LAYERS: Layer[] = [];

    // resolved を渡すと、当たったルートのミドルウェア(route.use)を、アプリのミドルウェアの後ろに足す
    function applicableMiddlewares(c: Context, resolved?: Resolved): Layer[] {
        const own = resolved?.kind === "route" ? resolved.route.use : undefined;
        if (middlewares.length === 0) return own ?? NO_LAYERS;
        let segments: readonly string[] | null;
        try {
            segments = c.segments;
        } catch {
            // パスが不正なら、パス指定のミドルウェアは動かさない(どのみちルーターが 400 にする)
            segments = null;
        }
        const layers: Layer[] = [];
        for (let i = 0; i < middlewares.length; i++) {
            const { name, mw, prefix } = middlewares[i]!;
            if (prefix === null || (segments !== null && startsWithSegments(segments, prefix))) {
                // order は登録順(1 から)。同じ関数を2回登録しても区別できるよう、配列の位置から決める
                // (ダッシュボードで、名前ではなく登録順で集計するのに使う)
                layers.push({ name, mw, order: i + 1 });
            }
        }
        if (own) layers.push(...own);
        return layers;
    }

    const app: App<V> = {
        use: guard((pathOrMw: string | Middleware<V>, mw?: Middleware<V>) => {
            const written = typeof pathOrMw === "string" ? pathOrMw : null;
            const fn = typeof pathOrMw === "string" ? mw : pathOrMw;
            if (!fn) throw senriError("no_middleware", `Missing middleware: ${written}`);
            const path = written === null ? null : middlewarePath(written);

            middlewares.push({
                // 関数の名前を使う。無名の関数(その場で書いたアロー関数など)は登録順の番号で呼ぶ
                name: fn.name || `anonymous#${middlewares.length + 1}`,
                anonymous: !fn.name,
                path,
                prefix: path === null ? null : splitPattern(path),
                mw: fn,
            });
        }),

        onError(handler: ErrorHandler<V>) {
            onError = handler;
        },

        notFound(handler: NotFoundHandler<V>) {
            notFound = handler;
        },

        // どれも app.get(path, handler) か、スキーマを付けた app.get(path, { params, query, body }, handler)(src/validate.ts)
        get: method("GET"),
        post: method("POST"),
        put: method("PUT"),
        patch: method("PATCH"),
        delete: method("DELETE"),
        // 登録しなければ GET を使う(ボディは送らない)。登録すれば GET より優先される
        head: method("HEAD"),
        // 登録しなければ 204 と Allow を自動で返す。登録すればそちらが優先される
        options: method("OPTIONS"),
        // どのメソッドでも動く。ただし、メソッドが合うルートがあればそちらが優先
        all: method("ALL"),

        // 任意のメソッド(QUERY や、PROPFIND などの WebDAV)を登録する。配列でまとめて登録もできる
        // 小文字で書いても大文字にする。CONNECT / TRACE / TRACK は扱わない
        on: guard((methods: string | readonly string[], path: string, a: Handler | RouteSchemas, b?: Handler) => {
            const list = typeof methods === "string" ? [methods] : methods;
            if (list.length === 0) throw senriError("no_method", `Missing method: ${path}`);
            const handler = routeHandler(path, a, b);
            for (const m of list) {
                if (m.toUpperCase() === "ALL") throw senriError("on_all", "Use app.all() for every method");
                add(m, path, handler, typeof a === "function" ? undefined : a);
            }
        }) as OnMethod<V>,

        // K はテーブルのキーから推論される。各キーのパスからパラメーターの型が決まる
        // 値は、ハンドラーか、defineRoutes() の表の endpoint()(スキーマ付き)
        routes: guard((table: object) => {
            for (const [key, value] of Object.entries(table)) {
                const [method, path] = key.split(" ");
                if (!method || !path) throw senriError("route_key", `Invalid route key: "${key}" (e.g. "GET /hello")`);
                if (isEndpoint(value)) {
                    // スキーマ(params / query / body)と、それ以外(use はミドルウェア、ほかは OpenAPI 用)を分ける
                    // (開発モードがスキーマのキーを確かめるため)
                    const { use, response, responses, bodyType, openapi, ...schemas } = value.schemas;
                    // スキーマがなければ、確かめる処理で包まない(use だけのルート)
                    let handler = Object.keys(schemas).length === 0 ? (value.handler as Handler) : routeHandler(path, schemas, value.handler as Handler);
                    // 開発モードでは、ハンドラーの戻り値を response のスキーマで確かめる(本番では確かめない)
                    if (response && devHooks?.watchResponse) handler = devHooks.watchResponse(`${method.toUpperCase()} ${path}`, response, handler);
                    add(method.toUpperCase(), path, handler, schemas, use as readonly Middleware[] | undefined);
                }
                else if (typeof value === "function") add(method.toUpperCase(), path, value as Handler);
                else throw senriError("route_value", `Invalid route: "${key}"`);
            }
        }) as App<V>["routes"],

        // createRouter() で作ったルーターをつなげる。ルーターに登録済みのものが、この時点でアプリに入る
        // app.route(prefix, app) なら、別のアプリをプレフィックス付きでつなげる
        // (つなぐ側のアプリでは、プレフィックスのパラメーターに型は付かない。型が必要なら createRouter を使う)
        // つないだアプリの onError / notFound は使わず、こちらのものを使う
        route: guard((routerOrPrefix: Router<string, V> | string, child?: MountableApp) => {
            // 先に全部読んでおく(ルーターの作りがおかしいときに、途中まで登録された状態にしない)
            let list: GroupEntry[];
            if (typeof routerOrPrefix === "string") {
                const read = child ? appEntries.get(child) : undefined;
                if (!read) throw senriError("not_app", new TypeError(`Not an app from createApp(): ${routerOrPrefix}`));
                list = read().map((entry) => ({ ...entry, path: joinPath(routerOrPrefix, entry.path) }));
            } else {
                list = groupEntries(routerOrPrefix);
            }
            for (const entry of list) {
                if (entry.kind === "use") app.use(entry.path, entry.mw);
                else add(entry.method, entry.path, entry.handler);
            }
        }),

        middlewareList() {
            return middlewares.map((m) => ({ name: m.name, path: m.path, anonymous: m.anonymous }));
        },

        routeList() {
            return routes.map((r) => ({ method: r.method, path: r.path }));
        },

        // info: ランタイムが渡す2つ目の引数(Bun の server、Deno の info など)。接続元のアドレスを取るのに使う
        // (形で見分けるので、Cloudflare Workers の env のような別のものが来ても壊れない。src/dev/dashboard/access.ts)
        // ctx: Cloudflare Workers の3つ目の引数(c.executionCtx)。export default app で、Workers がそのまま呼ぶ
        fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response> {
            // 開発モードは計測・記録をするので別の道を通る(@senrijs/senri/dev)
            if (devHooks) return devHooks.fetch(req, info, ctx);
            try {
                const c = new Context<V>(req, info, ctx);
                const cap = capRequest(c);
                const resolved = resolve(c);
                if (resolved.kind === "route") {
                    c.route = resolved.route.path;
                    c.params = resolved.params;
                }
                const fail = (err: unknown) => handleError(err, c, onError, notFound);
                // 本文の上限を超えていたら、ハンドラーがエラーを握りつぶしていても 413 にする
                const end = (res: Response) => (cap?.exceeded ? tooLargeResponse() : c.finalize(res));
                const layers = applicableMiddlewares(c, resolved);
                if (layers.length > 0) return compose(layers, c, () => inner(c, resolved), fail).then(end);
                // 近道: ミドルウェアがなければ compose を通さない。同期のハンドラーなら、待たずにそのまま返す
                let res: Response | Promise<Response>;
                try {
                    res = inner(c, resolved);
                } catch (err) {
                    res = fail(err);
                }
                if (res instanceof Promise) return res.catch(fail).then(end);
                return Promise.resolve(end(res));
            } catch (err) {
                return Promise.reject(err);
            }
        },
    };

    // ミドルウェアを全部通ったあとに動く、いちばん内側の処理
    // 同期で返せるときは Response をそのまま返す(Promise を作らない)
    function inner(c: Context<V>, resolved: Resolved): Response | Promise<Response> {
        switch (resolved.kind) {
            case "badRequest":
                throw resolved.error;
            case "route": {
                const route = resolved.route;
                // QUERY として登録したルートだけ、ボディと Content-Type を確かめる(app.all はハンドラーに任せる)
                if (route.method === "QUERY") {
                    return checkQueryRequest(c).then((invalid) => {
                        if (invalid) throw invalid;
                        return callHandler(c, route);
                    });
                }
                return callHandler(c, route);
            }
            case "options":
                return new Response(null, { status: 204, headers: { allow: resolved.allow } });
            case "methodNotAllowed":
                throw methodNotAllowed(resolved.allow);
            case "notImplemented":
                throw new HttpError(501, "501 Not Implemented");
            case "notFound":
                return notFoundResponse(c, notFound);
        }
    }

    function callHandler(c: Context<V>, route: Route): Response | Promise<Response> {
        const value = route.handler(c.params, c);
        // 同期のハンドラーなら待たない
        return value instanceof Promise ? value.then((v) => respond(c, route, v)) : respond(c, route, value);
    }

    function respond(c: Context<V>, route: Route, value: HandlerResult): Response | Promise<Response> {
        let res: Response;
        try {
            res = c.toResponse(value);
        } catch (err) {
            // どこが返した値かは、失敗したときだけ組み立てる
            throw markConversionError(err, { kind: "handler", name: `${route.method} ${route.path}` });
        }
        if (c.req.method !== "HEAD") return res;
        // HEAD はヘッダーと status だけ返す(ボディは捨てる)
        return (async () => {
            await res.body?.cancel();
            return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
        })();
    }

    // ミドルウェアを先に、ルートはそのあと(どちらも登録順)
    appEntries.set(app, () => [
        ...middlewares.map((m): GroupEntry => ({ kind: "use", path: m.path ?? "/", mw: m.mw as Middleware })),
        ...routes.map((r): GroupEntry => ({ kind: "route", method: r.method, path: r.path, handler: r.handler })),
    ]);

    const core: AppCore = {
        app,
        resolve,
        layers: applicableMiddlewares,
        inner: inner as AppCore["inner"],
        fail: (err, c) => handleError(err, c, onError, notFound),
        routes: () => routes,
        defaultNotFound: () => notFound === defaultNotFound,
        maxBodySize,
        capBody: capRequest,
    };

    // 開発モード: 中身を渡して、開発用の fetch と既定の onError / notFound を受け取る
    if (!options.dev) {
        nodeCores.set(app, core);
    } else {
        devHooks = options.dev.install(core);
        onError = devHooks.onError;
        notFound = devHooks.notFound;
    }

    return app;
}
