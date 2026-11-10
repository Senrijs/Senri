// ルートを表にまとめて定義する(型を持ったまま外に出せる。型付きクライアントや OpenAPI の元にする)
// - defineRoutes(table) / defineRoutes(prefix)(table): 表を作る。キーは "GET /users/:id" のように書く
// - endpoint(schemas, handler): スキーマを付けたルート。app.post(path, schemas, handler) の 2 つ目と 3 つ目の引数
// - mergeRoutes(...tables): 表を 1 つにする(同じキーはエラー)
// 作った表は app.routes(table) で登録する
//
// 型の作り(docs/design/0.3.0.md):
// - ハンドラーの引数の型は、キーのパスから決める。表の値の型(ハンドラーの戻り値など)は、そのまま残す
// - 前置きは 2 段(defineRoutes(prefix)(table))。同じ呼び出しで前置きを推論すると、ハンドラーの引数に型が付かない
// - スキーマの型はルートごとに違うので、endpoint() で包む(表の中のオブジェクトからは推論できない)
import type { Context, Handler, HandlerResult } from "./context.ts";
import { senriError } from "./errors.ts";
import type { ExtractParams, Simplify } from "./router.ts";
import type { RouteSchemas, Validated, ValidatedParams } from "./validate.ts";

// 前置きとパスをつなぐ。前置きが "" か "/" ならパスのまま。パスが "/" なら前置きのまま
type Join<P extends string, Path extends string> = P extends "" | "/" ? Path : Path extends "/" ? P : `${P}${Path}`;

/** The path parameters of a route key (`"GET /users/:id"`) under a prefix. */
export type RouteParams<P extends string, K> = K extends `${string} ${infer Path}` ? Simplify<ExtractParams<Join<P, Path>>> : never;

/**
 * A route with Standard Schema validation, made by {@link endpoint} and used as a value in {@link defineRoutes}.
 * `P` is the path parameters (from the route key), `S` the schemas, `R` the handler's return type and `V` the app's type.
 */
export interface Endpoint<P = Record<string, string>, S extends RouteSchemas = RouteSchemas, R = unknown, V extends object = any> {
    /** The schemas given to {@link endpoint}. */
    readonly schemas: S;
    // メソッドの形にして、引数の型の比べをゆるくする(スキーマの型が違う endpoint を、同じ表の型に置けるように)
    /** The handler given to {@link endpoint}. */
    handler(params: ValidatedParams<S, P>, c: Context<V, Validated<S>>): R;
    // 型のためだけ(実行時にはない)。置かれた場所のパラメーターの型を、ここから推論する
    // これもメソッドの形(表の外で作った endpoint も置けるように)
    /** Type information only; not present at runtime. */
    "~types"?(params: P, app: V): void;
}

// endpoint() が作ったもの(app.routes() が、ハンドラーと見分けるため)
const endpoints = new WeakSet<object>();

/** Whether a value was made by {@link endpoint}. */
export const isEndpoint = (value: unknown): value is Endpoint<any, RouteSchemas, unknown, any> =>
    typeof value === "object" && value !== null && endpoints.has(value);

// P は、表のキーから決まる(endpoint() の戻り値が置かれた場所の型から推論される)
/**
 * A route with Standard Schema validation, for use as a value in {@link defineRoutes}. The arguments are the same as
 * the schemas and handler of `app.post(path, { params, query, body }, handler)`. The path parameters are typed
 * from the route key the endpoint is placed under.
 *
 * @example
 * ```ts
 * import { defineRoutes, endpoint } from "@senrijs/senri";
 *
 * export const routes = defineRoutes({
 *     "POST /users": endpoint({ body: userSchema }, (_, c) => ({ created: c.valid("body") })),
 * });
 * ```
 */
export function endpoint<
    P = Record<string, string>,
    const S extends RouteSchemas = {},
    R extends HandlerResult | Promise<HandlerResult> = HandlerResult,
    V extends object = any,
>(schemas: S, handler: (params: ValidatedParams<S, P>, c: Context<V, Validated<S>>) => R): Endpoint<P, S, R, V> {
    if (typeof handler !== "function") throw senriError("no_handler", "Missing handler: endpoint()");
    const value = { schemas, handler };
    endpoints.add(value);
    return value;
}

// 表の値として書けるもの。キーの書き方が違えば、値の型の代わりに直し方を出す
// app.routes() も、defineRoutes() の表を受けるときに使う
/** What a table of routes may contain: handlers or {@link endpoint}s, keyed by `"METHOD /path"` under the prefix `P`. */
export type TableShape<P extends string, T, V extends object> = {
    [K in keyof T]: K extends `${string} ${string}`
        ? Handler<RouteParams<P, K>, V> | Endpoint<RouteParams<P, K>, any, any, V>
        : 'The route is not written correctly. Put a space between the method and the path, as in "GET /hello"';
};

/**
 * A table of routes made by {@link defineRoutes}: keys are `"METHOD /path"` (with the prefix), values are handlers
 * or {@link endpoint}s. Register it with `app.routes(table)`; its type can be shared with a typed client.
 */
export type Routes<P extends string = "", T = Record<string, unknown>> = {
    readonly [K in keyof T as K extends `${infer M} ${infer Path}` ? `${M} ${Join<P, Path & string>}` : never]: T[K];
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

// 表のキーに前置きを付ける。キーの書き方は app.routes() と同じく確かめる
function prefixTable(prefix: string, table: object): RoutesTable {
    const out: Record<string, RoutesTable[string]> = {};
    for (const [key, value] of Object.entries(table)) {
        const space = key.indexOf(" ");
        const method = key.slice(0, space);
        const path = key.slice(space + 1);
        if (space <= 0 || !path.startsWith("/")) throw senriError("route_key", `Invalid route key: "${key}" (e.g. "GET /hello")`);
        if (typeof value !== "function" && !isEndpoint(value)) throw senriError("route_value", `Invalid route: "${key}"`);
        out[`${method} ${prefix && path === "/" ? prefix : prefix + path}`] = value;
    }
    return out;
}

/**
 * Defines a table of routes. Keys are `"METHOD /path"`; values are handlers, or {@link endpoint}s for routes
 * with schemas. Path parameters are typed from the key, and the table keeps the handlers' types, so
 * `typeof routes` can be shared with a typed client. Register it with `app.routes(routes)`.
 *
 * With a prefix, call it twice: `defineRoutes("/orgs/:orgId")({ ... })`. The prefix is added to every key
 * (`"GET /"` becomes `"GET /orgs/:orgId"`), and its parameters are typed in the handlers.
 * To type `c.get()` / `c.set()`, give the app's type: `defineRoutes<"/admin", Vars>("/admin")({ ... })`.
 *
 * Throws if a key is not `"METHOD /path"`, if a value is not a handler or an endpoint, or if the prefix does not
 * start with `/` or ends with `/`. Other checks (path syntax, duplicates) happen in `app.routes()`.
 *
 * @example
 * ```ts
 * import { createApp, defineRoutes, endpoint } from "@senrijs/senri";
 *
 * export const routes = defineRoutes({
 *     "GET /users/:id": ({ id }) => ({ id }),
 *     "POST /users": endpoint({ body: userSchema }, (_, c) => ({ created: c.valid("body") })),
 * });
 * export const orgRoutes = defineRoutes("/orgs/:orgId")({
 *     "GET /members": ({ orgId }) => listMembers(orgId),
 * });
 *
 * const app = createApp();
 * app.routes(routes);
 * app.routes(orgRoutes);
 * ```
 */
export function defineRoutes<const T extends object>(table: T & NoInfer<TableShape<"", T, Record<string, unknown>>>): Routes<"", T>;
export function defineRoutes<P extends string, V extends object = Record<string, unknown>>(
    prefix: P,
): <const T extends object>(table: T & NoInfer<TableShape<P, T, V>>) => Routes<P, T>;
export function defineRoutes(arg: string | object): unknown {
    if (typeof arg !== "string") return prefixTable("", arg);
    const prefix = checkPrefix(arg);
    return (table: object) => prefixTable(prefix, table);
}

// 表の型を 1 つに合わせる
type Merge<T extends readonly unknown[]> = T extends readonly [infer H, ...infer Rest] ? H & Merge<Rest> : {};

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
export function mergeRoutes<const T extends readonly RoutesTable[]>(...tables: T): Simplify<Merge<T>> {
    const out: Record<string, RoutesTable[string]> = {};
    for (const table of tables) {
        for (const [key, value] of Object.entries(table)) {
            if (key in out) throw senriError("route_merge", `Duplicate route key: "${key}"`);
            out[key] = value;
        }
    }
    return out as Simplify<Merge<T>>;
}
