// ルートを表にまとめて定義する(型を持ったまま外に出せる。型付きクライアントや OpenAPI の元にする)
// - defineRoutes(table) / defineRoutes(prefix, { use })(table): 表を作る。キーは "GET /users/:id" のように書く
// - endpoint({ use, params, query, body }, handler): スキーマやミドルウェアを付けたルート
// - mergeRoutes(...tables): 表を 1 つにする(同じキーはエラー)
// 作った表は app.routes(table) で登録する
//
// 型の作り(docs/design/0.3.0.md):
// - ハンドラーの引数の型は、キーのパスから決める。表の値の型(ハンドラーの戻り値など)は、そのまま残す
// - 前置きは 2 段(defineRoutes(prefix)(table))。同じ呼び出しで前置きを推論すると、ハンドラーの引数に型が付かない
// - スキーマの型はルートごとに違うので、endpoint() で包む(表の中のオブジェクトからは推論できない)
//
// ミドルウェアの順番: アプリの app.use() → 表の use → ルートの use → スキーマの確認 → ハンドラー
// (ルートの use は、リクエストがそのルートに当たったときだけ、アプリのミドルウェアの後ろに足す。src/app.ts)
import type { Context, Handler, HandlerResult, MiddlewareProvides, MiddlewareVars, VarsRoute, WithVars } from "./context.ts";
import { senriError } from "./errors.ts";
import type { ExtractParams, Simplify } from "./router.ts";
import type { RouteInfoOf, RouteMiddleware, RouteSchemas, StandardSchemaV1, ValidatedParams } from "./validate.ts";

export type { MiddlewareVars, UnionToIntersection } from "./context.ts";
export type { RouteMiddleware } from "./validate.ts";

// 前置きとパスをつなぐ。前置きが "" か "/" ならパスのまま。パスが "/" なら前置きのまま
/** A route path under a prefix: `JoinPath<"/users", "/:id">` is `"/users/:id"`; `"/"` under a prefix is the prefix itself. */
export type JoinPath<P extends string, Path extends string> = P extends "" | "/" ? Path : Path extends "/" ? P : `${P}${Path}`;

/** The path parameters of a route key (`"GET /users/:id"`) under a prefix. */
export type RouteParams<P extends string, K> = K extends `${string} ${infer Path}` ? Simplify<ExtractParams<JoinPath<P, Path>>> : never;

// OpenAPI の operation に、そのまま入れる項目(@senrijs/senri/openapi が読む)
/** OpenAPI fields for a route, copied into its operation by `openAPI()` from `@senrijs/senri/openapi`. */
export type OpenAPIOperationInfo = {
    /** A short summary. */
    summary?: string;
    /** A longer description (CommonMark). */
    description?: string;
    /** Tags for grouping. */
    tags?: string[];
    /** A unique id for the operation. */
    operationId?: string;
    /** Marks the operation as deprecated. */
    deprecated?: boolean;
    /** Security requirements, such as `[{ bearerAuth: [] }]` (define the schemes in `openAPI(routes, { components })`). */
    security?: Record<string, string[]>[];
};

/** The first argument of {@link endpoint}: Standard Schema validation, middleware, and what OpenAPI needs. */
export type EndpointOptions = RouteSchemas & {
    /** Middleware for this route only. It runs after the app's and the table's middleware, before validation. */
    use?: RouteMiddleware;
    /**
     * The schema of a successful (200) response body. Used by `openAPI()` and, in development mode, to check the
     * handler's return value (a mismatch is printed as a warning; production does not check it).
     */
    response?: StandardSchemaV1;
    /** Schemas of other responses by status, such as `{ 404: notFoundSchema }`. Used by `openAPI()` only. */
    responses?: Record<number, StandardSchemaV1>;
    /** How the body is sent, for `openAPI()`: `"json"` (default) or `"form"` (urlencoded or multipart). */
    bodyType?: "json" | "form";
    /** OpenAPI fields for this route (summary, description, tags, operationId, deprecated, security). */
    openapi?: OpenAPIOperationInfo;
};


/** The options of {@link defineRoutes}. */
export type TableOptions = {
    /** Middleware for every route in the table. It runs after the app's middleware, before each route's own. */
    use?: RouteMiddleware;
};

// endpoint() のハンドラーの c の型
// - アプリの型に、use のミドルウェアが読む変数を「あるかもしれない」ものとして足す
// - use のミドルウェア(と、表の use。X)が「必ず入れる」と宣言した変数は、undefined なしで足す
/**
 * The context of an endpoint's handler, for the path parameters `P`, the options `S`, the app's type `V` and the
 * variables `X` that the table's middleware always set.
 */
export type EndpointContext<P, S extends EndpointOptions, V extends object, X extends object = {}> = Context<
    WithVars<V, MiddlewareVars<S["use"]>>,
    RouteInfoOf<S, P, X>
>;

/**
 * A route with Standard Schema validation or its own middleware, made by {@link endpoint} and used as a value in
 * {@link defineRoutes}. `P` is the path parameters (from the route key), `S` the options, `R` the handler's return
 * type, `V` the app's type and `X` the variables that the table's middleware always set.
 */
export interface Endpoint<P = Record<string, string>, S extends EndpointOptions = EndpointOptions, R = unknown, V extends object = any, X extends object = {}> {
    /** The options given to {@link endpoint}. */
    readonly schemas: S;
    // メソッドの形にして、引数の型の比べをゆるくする(スキーマの型が違う endpoint を、同じ表の型に置けるように)
    /** The handler given to {@link endpoint}. */
    handler(params: ValidatedParams<S, P>, c: EndpointContext<P, S, V, X>): R;
    // 型のためだけ(実行時にはない)。置かれた場所のパラメーターの型と、表の use が入れる変数を、ここから推論する
    // これもメソッドの形(表の外で作った endpoint も置けるように)
    /** Type information only; not present at runtime. */
    "~types"?(params: P, app: V, vars: X): void;
}

// endpoint() が作ったもの(app.routes() が、ハンドラーと見分けるため)
const endpoints = new WeakSet<object>();

/** Whether a value was made by {@link endpoint}. */
export const isEndpoint = (value: unknown): value is Endpoint<any, EndpointOptions, unknown, any> =>
    typeof value === "object" && value !== null && endpoints.has(value);

function makeEndpoint(schemas: EndpointOptions, handler: Function): Endpoint<any, EndpointOptions, unknown, any> {
    const value = { schemas, handler } as Endpoint<any, EndpointOptions, unknown, any>;
    endpoints.add(value);
    return value;
}

// ミドルウェアの並びを確かめる(関数でないものは、登録した時点でエラーにする)
export function checkUse(use: RouteMiddleware | undefined, where: string): void {
    if (use === undefined) return;
    if (!Array.isArray(use) || use.some((mw) => typeof mw !== "function")) {
        throw senriError("no_middleware", `Invalid middleware: ${where} (use takes an array of middleware)`);
    }
}

// P は、表のキーから決まる(endpoint() の戻り値が置かれた場所の型から推論される)
/**
 * A route with Standard Schema validation or its own middleware, for use as a value in {@link defineRoutes}.
 * The schemas and handler are the same as in `app.post(path, { params, query, body }, handler)`, and `use` adds
 * middleware for this route only (after the app's and the table's middleware, before validation).
 * The path parameters are typed from the route key the endpoint is placed under. Variables that the middleware in
 * `use` (and in the table's `use`) declare they always set (`Middleware<V, { vars: { user: User } }>`) are typed in
 * `c.get()` without `undefined`; variables they only read (`Middleware<{ user: User }>`) are typed with `undefined`.
 * With a `params` schema, `c.params` is typed as its output, the same as the first argument.
 *
 * Throws if the handler is missing or `use` is not an array of functions.
 *
 * @example
 * ```ts
 * import { defineRoutes, endpoint } from "@senrijs/senri";
 *
 * export const routes = defineRoutes({
 *     "POST /users": endpoint({ body: userSchema }, (_, c) => ({ created: c.valid("body") })),
 *     "DELETE /users/:id": endpoint({ use: [requireAdmin] }, ({ id }) => deleteUser(id)),
 * });
 * ```
 */
export function endpoint<
    P = Record<string, string>,
    const S extends EndpointOptions = {},
    R extends HandlerResult | Promise<HandlerResult> = HandlerResult,
    V extends object = any,
    X extends object = {},
>(schemas: S, handler: (params: ValidatedParams<S, P>, c: EndpointContext<P, S, V, X>) => R): Endpoint<P, S, R, V, X> {
    if (typeof handler !== "function") throw senriError("no_handler", "Missing handler: endpoint()");
    checkUse(schemas.use, "endpoint()");
    return makeEndpoint(schemas, handler) as unknown as Endpoint<P, S, R, V, X>;
}

// 表の値として書けるもの。キーの書き方が違えば、値の型の代わりに直し方を出す
// app.routes() も、defineRoutes() の表を受けるときに使う
// X は表の use のミドルウェアが「必ず入れる」と宣言した変数(c.get() に undefined が付かない)
/**
 * What a table of routes may contain: handlers or {@link endpoint}s, keyed by `"METHOD /path"` under the prefix `P`.
 * `V` is the app's type and `X` the variables that the table's middleware always set.
 */
export type TableShape<P extends string, T, V extends object, X extends object = {}> = {
    [K in keyof T]: K extends `${string} ${string}`
        ? Handler<RouteParams<P, K>, V, VarsRoute<X>> | Endpoint<RouteParams<P, K>, any, any, V, X>
        : 'The route is not written correctly. Put a space between the method and the path, as in "GET /hello"';
};

// endpoint の use の前に、表の use を足す(実行時の buildTable と同じ順番)
/** An endpoint's options with the table's middleware `U` put before its own `use`, as at runtime. */
export type WithTableUse<S, U extends RouteMiddleware> = Omit<S, "use"> & {
    use: readonly [...U, ...(S extends { use: infer W extends RouteMiddleware } ? W : [])];
};

// 表に use を付けたときは、ハンドラーだけの値も endpoint() で包んだものになる(実行時と型を合わせる)
// endpoint の値も、表の use を自分の use の前に足した形にする(型付きクライアントが、表のミドルウェアの状態コードも読めるように)
/**
 * The type of a table made with `defineRoutes(prefix, { use })`: with middleware, handler-only routes become
 * {@link Endpoint}s, and endpoints get the table's middleware before their own `use`, as at runtime.
 */
export type RoutesWithUse<O, T> = O extends { use: infer U extends RouteMiddleware }
    ? U extends readonly []
        ? T
        : {
              [K in keyof T]: T[K] extends Endpoint<infer P, infer S, infer R, infer V, infer X>
                  ? WithTableUse<S, U> extends infer W extends EndpointOptions
                      ? Endpoint<P, W, R, V, X>
                      : never
                  : T[K] extends (...args: any) => infer R
                    ? Endpoint<any, { use: U }, R, any>
                    : T[K];
          }
    : T;

/**
 * A table of routes made by {@link defineRoutes}: keys are `"METHOD /path"` (with the prefix), values are handlers
 * or {@link endpoint}s. Register it with `app.routes(table)`; its type can be shared with a typed client.
 */
export type Routes<P extends string = "", T = Record<string, unknown>> = {
    readonly [K in keyof T as K extends `${infer M} ${infer Path}` ? `${M} ${JoinPath<P, Path & string>}` : never]: T[K];
};

/** A table of routes as `app.routes()` takes it: handlers or endpoints keyed by `"METHOD /path"`. */
export type RoutesTable = { readonly [key: string]: Handler<any, any, any> | Endpoint<any, any, any, any> };

// 前置きを確かめる。"/" で始まり、"/" で終わらない(つないだときに "//" にならないように)。"" と "/" は前置きなし
function checkPrefix(prefix: string): string {
    if (prefix === "" || prefix === "/") return "";
    if (!prefix.startsWith("/") || prefix.endsWith("/")) {
        throw senriError("route_prefix", `Invalid prefix: "${prefix}" (start with "/" and do not end with "/", e.g. "/users")`);
    }
    return prefix;
}

// 表のキーに前置きを付け、表の use を各ルートの前に付ける。キーの書き方は app.routes() と同じく確かめる
function buildTable(prefix: string, use: RouteMiddleware, table: object): RoutesTable {
    const out: Record<string, RoutesTable[string]> = {};
    for (const [key, value] of Object.entries(table)) {
        const space = key.indexOf(" ");
        const method = key.slice(0, space);
        const path = key.slice(space + 1);
        if (space <= 0 || !path.startsWith("/")) throw senriError("route_key", `Invalid route key: "${key}" (e.g. "GET /hello")`);
        let route: RoutesTable[string];
        if (isEndpoint(value)) {
            route = use.length === 0 ? value : makeEndpoint({ ...value.schemas, use: [...use, ...(value.schemas.use ?? [])] }, value.handler);
        } else if (typeof value === "function") {
            route = use.length === 0 ? (value as Handler) : makeEndpoint({ use }, value);
        } else {
            throw senriError("route_value", `Invalid route: "${key}"`);
        }
        out[`${method} ${prefix && path === "/" ? prefix : prefix + path}`] = route;
    }
    return out;
}

/**
 * Defines a table of routes. Keys are `"METHOD /path"`; values are handlers, or {@link endpoint}s for routes
 * with schemas or their own middleware. Path parameters are typed from the key, and the table keeps the handlers'
 * types, so `typeof routes` can be shared with a typed client. Register it with `app.routes(routes)`.
 *
 * With a prefix, call it twice: `defineRoutes("/orgs/:orgId")({ ... })`. The prefix is added to every key
 * (`"GET /"` becomes `"GET /orgs/:orgId"`), and its parameters are typed in the handlers.
 * `defineRoutes(prefix, { use })` adds middleware to every route in the table (`""` for no prefix).
 * Variables that middleware declares it always sets (`Middleware<V, { vars: { user: User } }>`) are typed in
 * `c.get()` without `undefined`; to type the app's own variables too, give the app's type:
 * `defineRoutes<"/admin", Vars>("/admin")({ ... })`.
 *
 * Throws if a key is not `"METHOD /path"`, if a value is not a handler or an endpoint, if `use` is not an array of
 * functions, or if the prefix does not start with `/` or ends with `/`. Other checks (path syntax, duplicates)
 * happen in `app.routes()`.
 *
 * @example
 * ```ts
 * import { createApp, defineRoutes, endpoint } from "@senrijs/senri";
 *
 * export const routes = defineRoutes({
 *     "GET /users/:id": ({ id }) => ({ id }),
 *     "POST /users": endpoint({ body: userSchema }, (_, c) => ({ created: c.valid("body") })),
 * });
 * export const adminRoutes = defineRoutes("/admin", { use: [auth] })({
 *     "GET /me": (_, c) => c.get("user"),
 * });
 *
 * const app = createApp();
 * app.routes(routes);
 * app.routes(adminRoutes);
 * ```
 */
export function defineRoutes<const T extends object>(table: T & NoInfer<TableShape<"", T, Record<string, unknown>>>): Routes<"", T>;
/**
 * Defines a table of routes under a prefix, in two steps: `defineRoutes("/orgs/:orgId")({ ... })`.
 * `options.use` adds middleware to every route in the table. See the first form for the details.
 */
export function defineRoutes<P extends string, V extends object = Record<string, unknown>, const O extends TableOptions = {}>(
    prefix: P,
    options?: O & TableOptions,
): <const T extends object>(
    table: T & NoInfer<TableShape<P, T, WithVars<V, MiddlewareVars<O["use"]>>, MiddlewareProvides<O["use"]>>>,
) => Routes<P, RoutesWithUse<O, T>>;
export function defineRoutes(arg: string | object, options?: TableOptions): unknown {
    if (typeof arg !== "string") return buildTable("", [], arg);
    const prefix = checkPrefix(arg);
    checkUse(options?.use, `defineRoutes("${arg}")`);
    const use = options?.use ?? [];
    return (table: object) => buildTable(prefix, use, table);
}

// 表の型を 1 つに合わせる
/** The type of tables merged with {@link mergeRoutes}: the intersection of the tables' types. */
export type MergeRoutes<T extends readonly unknown[]> = T extends readonly [infer H, ...infer Rest] ? H & MergeRoutes<Rest> : {};

/**
 * Merges tables from {@link defineRoutes} into one. Throws if two tables have the same key
 * (unlike `{ ...a, ...b }`, which silently keeps the last one).
 *
 * @example
 * ```ts
 * export const routes = mergeRoutes(userRoutes, orgRoutes);
 * export type Api = typeof routes;
 * ```
 */
export function mergeRoutes<const T extends readonly RoutesTable[]>(...tables: T): Simplify<MergeRoutes<T>> {
    const out: Record<string, RoutesTable[string]> = {};
    for (const table of tables) {
        for (const [key, value] of Object.entries(table)) {
            if (key in out) throw senriError("route_merge", `Duplicate route key: "${key}"`);
            out[key] = value;
        }
    }
    return out as Simplify<MergeRoutes<T>>;
}
