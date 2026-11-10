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

type BodyValue = Blob | ArrayBuffer | ArrayBufferView | ReadableStream | FormData | URLSearchParams;
type NotInJson = undefined | symbol | ((...args: any) => any);

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
type HandlerOf<V> = V extends { handler(...args: any): any } ? V["handler"] : V;
type SchemasOf<V> = V extends { schemas: infer S } ? S : {};
type ReturnOf<V> = HandlerOf<V> extends (...args: any) => infer R ? Awaited<R> : never;

// クライアントが受け取る本文の型。文字列はテキスト、バイト列やストリームは Blob、ほかは JSON にしたあとの形
// Response を返したものは中身が分からないので unknown
type DataOf<R> = [R] extends [never] ? unknown : R extends Response ? unknown : R extends string ? string : R extends BodyValue ? Blob : Jsonify<R>;

/** What a successful call returns as `data`, for the route `K` of the table `A`. */
export type ClientData<A, K extends keyof A> = DataOf<ReturnOf<A[K]>>;

type PathOf<K> = K extends `${string} ${infer Path}` ? Path : never;
type ParamsOf<K> = { [P in keyof ExtractParams<PathOf<K>>]: string | number };
type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[];

// 送るものの型。パラメーターはキーから。クエリとボディは、スキーマがあればその入力の型
type ParamsPart<K> = keyof ParamsOf<K> extends never ? { params?: undefined } : { params: Simplify<ParamsOf<K>> };
type QueryPart<S> = S extends { query: infer Q } ? { query: InferInput<Q> } : { query?: Record<string, QueryValue> };
type BodyPart<S> = S extends { body: infer B } ? { body: InferInput<B> } : { body?: unknown };

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
type InputArgs<A, K extends keyof A> = {} extends ClientInput<A, K> ? [input?: ClientInput<A, K>] : [input: ClientInput<A, K>];

/**
 * The result of a call. It does not throw for responses that are not 2xx: check `ok` (or `status`).
 * `data` has the type of the route's handler; `error` is the body of any other response, as `unknown`.
 */
export type ClientResult<D> =
    | { ok: true; status: number; data: D; error: undefined; response: Response }
    | { ok: false; status: number; data: undefined; error: unknown; response: Response };

/** A typed client for the table `A`: call it with a route key such as `"GET /users/:id"`. */
export type Client<A> = <K extends keyof A & string>(route: K, ...args: InputArgs<A, K>) => Promise<ClientResult<ClientData<A, K>>>;

/** Options for {@link client}. */
export type ClientOptions = {
    /** Headers sent with every call. A function is called for each call (to read a fresh token, for example). */
    headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
    /** The `fetch` to use. Default: the global `fetch`. Pass `app.fetch` to call an app without a server. */
    fetch?: (request: Request) => Response | Promise<Response>;
};

// --- 実行時 ---

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
    const base = baseUrl.replace(/\/+$/, "");
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
