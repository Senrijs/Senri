/**
 * Typed client for routes made with `defineRoutes()`: `client<Api>(baseUrl)`.
 * It imports only types from the server, so the server code is not bundled into the client.
 *
 * @example
 * ```ts
 * import { client } from "@senrijs/senri/client";
 * import type { Api } from "../server/routes.ts";
 *
 * const api = client<Api>("https://example.com");
 * const res = await api("GET /users/:id", { params: { id: "1" } });
 * if (res.ok) console.log(res.data);
 * ```
 *
 * @module
 */
// 型付きクライアント(docs/design/0.3.0.md の 1.10)
// - サーバーの表(defineRoutes() の戻り値)の型だけを使う。本体の実行時のコードは読まない(このファイルだけで動く)
// - 呼び方は、表のキーと同じ "GET /users/:id"。Proxy を使わない
// - 成功でなくても例外にしない(ネットワークのエラーと、本文が壊れていたときだけ例外)
// - レスポンスの型は成功の型だけ(ハンドラーの戻り値)。onError やミドルウェアの応答は error(unknown)
// - クライアントの型は、JSON にしたあとの形(Date → string など)
import type { ExtractParams, Simplify } from "./router.ts";
import type { InferInput } from "./validate.ts";

// --- 型 ---

/** Response bodies the client reads as a `Blob`. */
export type BodyValue = Blob | ArrayBuffer | ArrayBufferView | ReadableStream | FormData | URLSearchParams;
/** Values that `JSON.stringify` drops (or turns into `null` in arrays). */
export type NotInJson = undefined | symbol | ((...args: any) => any);

// JSON にしたあとの形(JSON.stringify と同じ規則)
// - toJSON() があれば、その戻り値(Date → string)
// - undefined・関数・symbol のプロパティは消える。配列の中では null になる
// - Map や Set などのプロパティを持たないものは {}
/** The type of a value after `JSON.stringify` and `JSON.parse` (`Date` becomes `string`, and so on). */
export type Jsonify<T> = T extends { toJSON(...args: any): infer J }
    ? Jsonify<J>
    : T extends string | number | boolean | null
      ? T
      : T extends bigint
        ? never
        : T extends NotInJson
          ? never
          : T extends readonly unknown[]
            ? { [K in keyof T]: T[K] extends NotInJson ? null : Jsonify<T[K]> }
            : T extends Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any>
              ? {}
              : T extends object
                ? Simplify<
                      { [K in keyof T as K extends symbol ? never : T[K] extends NotInJson ? never : undefined extends T[K] ? never : K]: Jsonify<T[K]> } & {
                          [K in keyof T as K extends symbol ? never : T[K] extends NotInJson ? never : undefined extends T[K] ? K : never]?: Jsonify<Exclude<T[K], undefined>>;
                      }
                  >
                : unknown;

// 表の値から、ハンドラーとスキーマを取り出す(ハンドラーだけの値か、endpoint())
/** The handler of a table value: the value itself, or an endpoint's `handler`. */
export type HandlerOf<V> = V extends { handler(...args: any): any } ? V["handler"] : V;
/** The schemas of a table value (an endpoint's options), or `{}` for a plain handler. */
export type SchemasOf<V> = V extends { schemas: infer S } ? S : {};
/** The awaited return type of a table value's handler. */
export type ReturnOf<V> = HandlerOf<V> extends (...args: any) => infer R ? Awaited<R> : never;

// クライアントが受け取る本文の型。文字列はテキスト、バイト列やストリームは Blob、ほかは JSON にしたあとの形
// Response を返したものは中身が分からないので unknown
/** What the client reads for a handler result `R`: text, a `Blob`, or the value after JSON. */
export type DataOf<R> = [R] extends [never] ? unknown : R extends Response ? unknown : R extends string ? string : R extends BodyValue ? Blob : Jsonify<R>;

// --- status ごとの型 ---
// - ハンドラーが c.json(body, 404) のように status を書いて返したもの(TypedResponse)
// - endpoint({ response, responses: { 404: schema } }) に書いたスキーマ
// 2xx は成功の data に、それ以外は status ごとの error に入る。書いていない status は error: unknown

/** 2xx status codes: a successful call (`ok: true`). */
export type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;
/** Status codes other than 2xx: a call that is not successful (`ok: false`). */
export type ErrorStatus =
    | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308
    | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418
    | 421 | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451
    | 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;

// c.json() / c.text() が返した印つきの Response(TypedResponse)の形。本体の実行時のコードは読まない(型だけ)
/** The shape of a response from `c.json()` / `c.text()` (`TypedResponse`), as the client sees it (types only). */
export type Typed<T = any, S extends number = any, F = any> = Response & { readonly "~typed": { readonly data: T; readonly status: S; readonly format: F } };

// 本文の型: JSON なら JSON にしたあとの形、テキストなら string
/** The body of a typed response: the value after JSON, or `string` for text. */
export type TypedData<T, F> = F extends "text" ? string : Jsonify<T>;
// スキーマの出力の型を、クライアントが受け取る形に
/** What the client reads for a schema: its output after JSON (or `string`). */
export type SchemaData<S> = S extends { readonly "~standard": { readonly types?: { readonly output: infer O } | undefined } }
    ? O extends string
        ? string
        : Jsonify<O>
    : unknown;

// ハンドラーの戻り値のうち、印つき(status を書いたもの)と、それ以外
/** The typed responses (`c.json(body, status)`) among a handler result `R`. */
export type TypedOf<R> = Extract<R, Typed>;
/** The handler results other than typed responses. */
export type PlainOf<R> = Exclude<R, Typed>;

// 印つきのうち 2xx のものの本文(status が数の型のまま=決まっていないものは、成功に入れる)
/** The bodies of typed responses with a 2xx status (or no literal status). */
export type TypedSuccess<R> = R extends Typed<infer T, infer S, infer F> ? (number extends S ? TypedData<T, F> : S extends SuccessStatus ? TypedData<T, F> : never) : never;
// responses のスキーマのうち 2xx のもの
/** The bodies of `responses` schemas with a 2xx status. */
export type SchemaSuccess<Sch> = Sch extends { responses: infer M } ? { [C in keyof M & SuccessStatus]: SchemaData<M[C]> }[keyof M & SuccessStatus] : never;
/** `unknown` when `T` is `never`, otherwise `T`. */
export type OrUnknown<T> = [T] extends [never] ? unknown : T;

/**
 * What a successful call returns as `data`, for the route `K` of the table `A`: the output of the route's `response`
 * schema if it has one, otherwise the handler's return value (after JSON), including `c.json(body, 2xx)`.
 */
export type ClientData<A, K extends keyof A> =
    SchemasOf<A[K]> extends { response: infer S }
        ? SchemaData<S> | SchemaSuccess<SchemasOf<A[K]>>
        : OrUnknown<([PlainOf<ReturnOf<A[K]>>] extends [never] ? never : DataOf<PlainOf<ReturnOf<A[K]>>>) | TypedSuccess<TypedOf<ReturnOf<A[K]>>> | SchemaSuccess<SchemasOf<A[K]>>>;

/** A result for a status other than 2xx that the route declares, with `error` typed. */
export type ClientErrorResult<S extends number, E> = { ok: false; status: S; data: undefined; error: E; response: Response };

// 2xx 以外の status ごとの結果(S は分配する)
/** A result for each non-2xx status in `S`, with `error` of type `E`. */
export type ErrorBranch<S, E> = S extends ErrorStatus ? ClientErrorResult<S, E> : never;
/** The results for typed responses with a non-2xx status. */
export type TypedErrors<R> = R extends Typed<infer T, infer S, infer F> ? (number extends S ? never : ErrorBranch<S, TypedData<T, F>>) : never;
/** The results for `responses` schemas with a non-2xx status. */
export type SchemaErrors<Sch> = Sch extends { responses: infer M } ? { [C in keyof M & ErrorStatus]: ClientErrorResult<C, SchemaData<M[C]>> }[keyof M & ErrorStatus] : never;
/** The `status` of a result type. */
export type StatusOf<B> = B extends { status: infer S } ? S : never;

/** The results of the route `K` for the statuses it declares (other than 2xx). */
export type ClientErrors<A, K extends keyof A> = TypedErrors<TypedOf<ReturnOf<A[K]>>> | SchemaErrors<SchemasOf<A[K]>>;

/**
 * The result of a call to the route `K` of the table `A`. Check `ok` (or `status`): `data` is typed for 2xx;
 * for statuses the route declares (`c.json(body, 404)`, or `endpoint({ responses })`), `error` is typed by status;
 * for any other status (`onError`, middleware, `notFound`), `error` is `unknown`.
 */
export type ClientResultOf<A, K extends keyof A> =
    | { ok: true; status: SuccessStatus; data: ClientData<A, K>; error: undefined; response: Response }
    | ClientErrors<A, K>
    | ClientErrorResult<Exclude<ErrorStatus, StatusOf<ClientErrors<A, K>>>, unknown>;

/** The path of a route key (`"GET /users/:id"` → `"/users/:id"`). */
export type PathOf<K> = K extends `${string} ${infer Path}` ? Path : never;
/** The path parameters a client sends for a route key (strings or numbers). */
export type ParamsOf<K> = { [P in keyof ExtractParams<PathOf<K>>]: string | number };
/** A query value the client sends (arrays repeat the key; `undefined` and `null` are left out). */
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[];

// 送るものの型。パラメーターはキーから。クエリとボディは、スキーマがあればその入力の型
/** The `params` part of {@link ClientInput}: required when the route has path parameters. */
export type ParamsPart<K> = keyof ParamsOf<K> extends never ? { params?: undefined } : { params: Simplify<ParamsOf<K>> };
/** The `query` part of {@link ClientInput}: the query schema's input type, or optional strings. */
export type QueryPart<S> = S extends { query: infer Q } ? { query: InferInput<Q> } : { query?: Record<string, QueryValue> };
/** The `body` part of {@link ClientInput}: the body schema's input type (required), or optional. */
export type BodyPart<S> = S extends { body: infer B } ? { body: InferInput<B> } : { body?: unknown };

/** Per-call options: what is sent with the request. */
export type CallOptions = {
    /** Headers for this call, added to the client's headers. */
    headers?: HeadersInit;
    /** Aborts the request. */
    signal?: AbortSignal;
};

/** The second argument of a call to the route `K` of the table `A`: path parameters, query, body and options. */
export type ClientInput<A, K extends keyof A> = Simplify<ParamsPart<K> & QueryPart<SchemasOf<A[K]>> & BodyPart<SchemasOf<A[K]>> & CallOptions>;

// 何も渡さなくてよいときは、2 つ目の引数を省ける
/** The arguments after the route key: the input may be left out when nothing is required. */
export type InputArgs<A, K extends keyof A> = {} extends ClientInput<A, K> ? [input?: ClientInput<A, K>] : [input: ClientInput<A, K>];

/**
 * The result of a call. It does not throw for responses that are not 2xx: check `ok` (or `status`).
 * `data` has the type of the route's handler; `error` is the body of any other response, as `unknown`.
 */
export type ClientResult<D> =
    | { ok: true; status: number; data: D; error: undefined; response: Response }
    | { ok: false; status: number; data: undefined; error: unknown; response: Response };

/** A typed client for the table `A`: call it with a route key such as `"GET /users/:id"`. */
export type Client<A> = <K extends keyof A & string>(route: K, ...args: InputArgs<A, K>) => Promise<ClientResultOf<A, K>>;

/** Options for {@link client}. */
export type ClientOptions = {
    /** Headers sent with every call. A function is called for each call (to read a fresh token, for example). */
    headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
    /** The `fetch` to use. Default: the global `fetch`. Pass `app.fetch` to call an app without a server. */
    fetch?: (request: Request) => Response | Promise<Response>;
};

// --- 実行時 ---

// 末尾の "/" を削る。/\/+$/ は、"/" が長く続いて最後が別の文字のとき、始まる位置ごとに読み直すので、
// 時間が長さの 2 乗になる。後ろから 1 文字ずつ見れば、長さに比例する
function trimTrailingSlashes(url: string): string {
    let end = url.length;
    while (end > 0 && url.charCodeAt(end - 1) === 47) end--; // "/"
    return url.slice(0, end);
}

// パスにパラメーターを入れる。値はエンコードする。ワイルドカード(*)は "/" を残して、セグメントごとにエンコードする
function fillPath(path: string, params: Record<string, unknown> | undefined): string {
    return path
        .split("/")
        .map((segment) => {
            if (segment === "*") {
                const value = String(params?.["*"] ?? "");
                return value.split("/").map(encodeURIComponent).join("/");
            }
            if (!segment.startsWith(":")) return segment;
            const name = segment.slice(1);
            const value = params?.[name];
            if (value === undefined || value === null) throw new TypeError(`Missing path parameter: ${name}`);
            return encodeURIComponent(String(value));
        })
        .join("/");
}

function queryString(query: Record<string, QueryValue> | undefined): string {
    if (!query) return "";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) for (const item of value) search.append(key, String(item));
        else search.append(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
}

// そのまま本文にできるもの(それ以外は JSON にする)
function isRawBody(body: unknown): body is BodyInit {
    return (
        body instanceof FormData ||
        body instanceof URLSearchParams ||
        body instanceof Blob ||
        body instanceof ArrayBuffer ||
        ArrayBuffer.isView(body) ||
        body instanceof ReadableStream
    );
}

// Content-Type で読み分ける。JSON(application/json と +json)・テキスト(text/*)・それ以外(Content-Type なしも)は Blob。本文がなければ null
async function readBody(res: Response, method: string): Promise<unknown> {
    if (method === "HEAD" || res.status === 204 || res.status === 205 || res.status === 304) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type === "application/json" || type.endsWith("+json")) {
        const text = await res.text();
        return text === "" ? null : JSON.parse(text);
    }
    if (type.startsWith("text/")) return res.text();
    return res.blob();
}

/**
 * Creates a typed client for a table of routes made with `defineRoutes()`. Pass the table's type
 * (`typeof routes`), not the table itself, so no server code is bundled.
 *
 * - Call it with the route key and the input: `api("GET /users/:id", { params: { id: "1" }, query, body })`.
 *   Path parameters are encoded into the path. `query` values are added as strings (arrays repeat the key).
 *   `body` is sent as JSON, except `FormData`, `URLSearchParams`, `Blob`, binary data and streams, which are sent as is.
 * - The result is `{ ok, status, data, error, response }`. It does not throw for responses that are not 2xx;
 *   it throws only if the request fails (network errors) or a JSON body cannot be parsed.
 * - The body is read by `Content-Type`: JSON is parsed, text is a string, anything else is a `Blob`.
 * - `data` is typed from the handler's return value, after JSON (`Date` becomes `string`). Responses from
 *   `onError`, middleware or `notFound` are not typed: they are in `error` as `unknown`.
 *
 * @param baseUrl The server's URL, such as `"https://example.com"` or `"https://example.com/api"`.
 *
 * @example
 * ```ts
 * import { client } from "@senrijs/senri/client";
 * import type { Api } from "../server/routes.ts";
 *
 * const api = client<Api>("https://example.com", {
 *     headers: () => ({ authorization: `Bearer ${getToken()}` }),
 * });
 * const res = await api("POST /users", { body: { name: "a" } });
 * if (!res.ok) throw new Error(`failed: ${res.status}`);
 * console.log(res.data.created);
 * ```
 */
export function client<A>(baseUrl: string, options: ClientOptions = {}): Client<A> {
    const base = trimTrailingSlashes(baseUrl);
    const call = async (route: string, input: (CallOptions & { params?: Record<string, unknown>; query?: Record<string, QueryValue>; body?: unknown }) = {}) => {
        const space = route.indexOf(" ");
        if (space <= 0) throw new TypeError(`Invalid route: "${route}" (e.g. "GET /hello")`);
        const method = route.slice(0, space).toUpperCase();
        const url = base + fillPath(route.slice(space + 1), input.params) + queryString(input.query);

        const shared = typeof options.headers === "function" ? await options.headers() : options.headers;
        const headers = new Headers(shared);
        new Headers(input.headers).forEach((value, key) => headers.set(key, value));

        let body: BodyInit | undefined;
        if (input.body !== undefined && method !== "GET" && method !== "HEAD") {
            if (isRawBody(input.body)) {
                body = input.body;
            } else {
                body = JSON.stringify(input.body);
                if (!headers.has("content-type")) headers.set("content-type", "application/json");
            }
        }

        const init: RequestInit & { duplex?: "half" } = { method, headers, body: body ?? null, signal: input.signal ?? null };
        // ストリームを本文にするときに必要(読みながら送る「半二重」の指定)
        if (body instanceof ReadableStream) init.duplex = "half";
        const request = new Request(url, init);
        const response = await (options.fetch ?? fetch)(request);
        const read = await readBody(response, method);
        return response.ok
            ? { ok: true, status: response.status, data: read, error: undefined, response }
            : { ok: false, status: response.status, data: undefined, error: read, response };
    };
    return call as unknown as Client<A>;
}
