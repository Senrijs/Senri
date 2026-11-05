import { pathnameOf, requestPathname, splitPath } from "./router.ts";
import { isConnectionInfo } from "./connection.ts";
import type { Timing } from "./compose.ts";
import { readBody } from "./body.ts";
import { HttpError, senriError } from "./errors.ts";

// そのままレスポンスのボディにできるもの(JSON にはしない)
// TypedArray は SharedArrayBuffer のもの以外(Response のボディにできないので)
export type BodyValue = Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer> | ReadableStream | FormData | URLSearchParams;

// JSON にするオブジェクト。関数(call を持つ)と Promise(then を持つ)は object でもあるので、ここで外す
// 関数を返すのはたいてい呼び忘れ、Promise は二重に包んでしまったときに起きる
export type JsonObject = object & { call?: never; then?: never };

/**
 * What a handler, middleware, `onError` or `notFound` can return:
 * - `Response`: used as is
 * - `string`: a `text/plain; charset=utf-8` response
 * - `Blob`, `ArrayBuffer`, typed arrays, `ReadableStream`, `FormData`, `URLSearchParams`: used as the body
 * - any other object: serialized as JSON
 *
 * Functions and promises are rejected by the type; `undefined` / `null` throw at runtime.
 */
export type HandlerResult = Response | string | BodyValue | JsonObject;

function isBodyValue(value: unknown): value is BodyValue {
    return (
        value instanceof Blob ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value) ||
        value instanceof ReadableStream ||
        value instanceof FormData ||
        value instanceof URLSearchParams
    );
}

// ボディの種類から決まる Content-Type。Bun は Headers に入れてくれないので、ランタイム差が出ないよう自分で入れる
// FormData は boundary 付きの値を Response が作るので、ここでは決めない
function contentTypeOf(value: BodyValue): string | undefined {
    if (value instanceof Blob) return value.type || undefined;
    if (value instanceof URLSearchParams) return "application/x-www-form-urlencoded;charset=UTF-8";
    return undefined;
}

// c.text() / c.json() / c.html() の既定の Content-Type。Response は渡された Headers をコピーして使うので、共有してよい
// (オブジェクトリテラルを渡すより速い。毎回 Headers に変換しなくて済むため)
const TEXT_HEADERS = new Headers({ "content-type": "text/plain; charset=utf-8" });
const JSON_HEADERS = new Headers({ "content-type": "application/json" });
const HTML_HEADERS = new Headers({ "content-type": "text/html; charset=utf-8" });

/** A status code accepted by {@link Context.redirect}. */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

// c.redirect() の値を、Location ヘッダーに入れる形にする
// - CR / LF はエラー。Headers は末尾の "\r\n" を黙って消し、new URL() も途中の改行を消すので、先に自分で確かめる
// - ASCII だけなら、そのまま(相対パスも通す)
// - ASCII 以外は、Bun / Deno / Node / ブラウザは投げ、workerd はそのまま送る。ランタイムで差が出ないよう、ここでエンコードする
//   - スキームから始まる絶対 URL は new URL() に任せる(ホスト名は punycode に、パスなどはパーセントエンコードに)
//   - それ以外は ASCII 以外の部分だけエンコードする(%2F などを二重にエンコードしない)
function toLocation(location: string): string {
    let cause: unknown;
    if (!/[\r\n]/.test(location)) {
        try {
            if (!/[^\x00-\x7f]/.test(location)) return location;
            return /^[a-z][a-z\d+.-]*:/i.test(location)
                ? new URL(location).href
                : location.replace(/[^\x00-\x7f]+/g, (s) => encodeURIComponent(s));
        } catch (err) {
            // 不正なサロゲート(encodeURIComponent)や、URL にならない値(new URL)
            cause = err;
        }
    }
    throw senriError("redirect_location", new TypeError(`Invalid redirect location: ${JSON.stringify(location)}`, { cause }));
}

// init のオブジェクトは毎回作る。Bun.serve では、同じ init を使い回した Response を返すと
// HTTP のスループットが数分の1に落ちる(プロセス内で fetch を呼ぶだけでは差が出ない。bench/http.ts で確認)
function initOf(status: number, type: string | null | undefined, headers: Headers): ResponseInit {
    return { status, headers: type ? { "content-type": type } : headers };
}

// Cloudflare Workers の fetch(req, env, ctx) の ctx。使う部分だけ自分で書く(Workers の型には依存しない)
/** The `ctx` argument of Cloudflare Workers' `fetch(req, env, ctx)`. Only the parts used here are typed. */
export type ExecutionContext = {
    /** Keeps the Worker running until the promise settles, after the response is sent. */
    waitUntil(promise: Promise<unknown>): void;
    /** Lets the request fall through to the origin if the Worker throws. */
    passThroughOnException(): void;
};

// アプリの型の指定は2通り:
// - createApp<{ user: User }>(): c.set / c.get で使う変数の型だけ(以前からの書き方)
// - createApp<{ Bindings: Env; Variables: { user: User } }>(): Workers の env(c.env)の型も決める
// Bindings か Variables を持っていれば後者として読む
type IsAny<T> = 0 extends 1 & T ? true : false;
type EnvForm = { Bindings: object } | { Variables: object };
/** The variables type (`c.set` / `c.get`) of an app type: `E["Variables"]` in the `{ Bindings, Variables }` form, otherwise `E` itself. */
export type VariablesOf<E> =
    IsAny<E> extends true ? any : E extends EnvForm ? (E extends { Variables: infer V extends object } ? V : Record<string, unknown>) : E;
/** The bindings type (`c.env`) of an app type: `E["Bindings"]` in the `{ Bindings, Variables }` form, otherwise `unknown`. */
export type BindingsOf<E> = IsAny<E> extends true ? any : E extends { Bindings: infer B extends object } ? B : unknown;

// V はアプリの型(上の2通りのどちらか)。createApp<...>() で決める
// 既定の any は「どのアプリでも使える」という意味。logger() のような汎用ミドルウェアのため
// I はスキーマで確かめた値の型(c.valid() で読めるもの)。スキーマを渡したルートだけ決まる(src/validate.ts)
/**
 * A route handler. Receives the path parameters and the context, and returns a {@link HandlerResult}.
 * `P` is the parameters, `V` the app's type, and `I` the values validated by the route's schemas (`c.valid()`).
 */
export type Handler<P = Record<string, string>, V extends object = any, I extends object = {}> = (
    params: P,
    c: Context<V, I>,
) => HandlerResult | Promise<HandlerResult>;

/** Runs the rest of the chain and returns its response. Throws if called twice. */
export type Next = () => Promise<Response>;

/**
 * Middleware. Call `next()` to run the rest of the chain, then either return nothing to use its response,
 * or return a value to respond with that instead. Returning a value without calling `next()` stops the chain there.
 * Returning nothing without calling `next()` is an error.
 */
export type Middleware<V extends object = any> = (
    c: Context<V>,
    next: Next,
) => HandlerResult | void | Promise<HandlerResult | void>;

// スキーマで確かめた値(src/validate.ts が入れる)。c.valid() で読む
const validated = new WeakMap<Context, Record<string, unknown>>();

export function setValidated(c: Context, target: string, value: unknown): void {
    let values = validated.get(c);
    if (!values) validated.set(c, (values = {}));
    values[target] = value;
}

// app.fetch に渡された元のリクエストと2つ目の引数を読む(Context の外から。@senrijs/senri/ip で使う)
// Context のメソッドにしないのは、使わないアプリのバンドルに入れないため
export let connectionOf: (c: Context) => { req: Request; info: unknown };

// Node のアダプターから来たリクエスト。create() は本物の Request(new Request で作ったもの)を返す
export type LazyRequest = { url: string; create(): Request };
// c.req を最初に読んだときに本物の Request を作る Context(Node のアダプターだけが使う)
export let lazyContext: (source: LazyRequest, info: unknown) => Context;

/**
 * The per-request context passed to handlers and middleware as `c`.
 * Holds the request, path parameters, variables, and the status and headers to add to the response.
 */
export class Context<V extends object = any, I extends object = {}> {
    // ふつうのプロパティ(ここでは定義だけ)。Bun / Deno / Workers / ブラウザでは、読み方が速さに影響しないように getter にしない
    /** The request. Middleware may replace it (for example, with a body that has a size limit). */
    declare req: Request;
    #status = 200;
    // c.header() で初めて作る(ほとんどのリクエストでは使わないので、毎回作らない)
    #headers: Headers | undefined;
    #segments: string[] | undefined;
    // 取り出したままの pathname と、正規化したパス(c.path)
    #pathname: string | undefined;
    #path: string | undefined;
    // c.set() で初めて作る
    #vars: Map<string, unknown> | undefined;
    // 一度読んだボディ(ミドルウェアとハンドラーの両方から読めるように覚えておく)
    #body: Promise<unknown> | undefined;
    #query: URLSearchParams | undefined;
    /**
     * The error being handled. Set when an error is thrown that is not an {@link HttpError},
     * or is an `HttpError` with status 500 or above; `undefined` otherwise. `logger()` prints it.
     */
    error: unknown = undefined;
    // マッチしたルートのパターン("/users/:id")。見つからなければ undefined
    // ミドルウェアより先にマッチするので、next() の前から読める(ログやダッシュボードの集計用)
    /** The matched route's pattern (`"/users/:id"`), or `undefined` if none matched. Set before middleware runs. */
    route: string | undefined = undefined;
    // パスパラメーター。ハンドラーでは第1引数でも受け取れる
    /**
     * The path parameters. Handlers also receive them as the first argument.
     * Replaced by the validated value when the route has a `params` schema.
     */
    params: Record<string, string> = {};
    #timings: Timing[] | undefined;

    // app.fetch に渡された元のリクエストと2つ目の引数(@senrijs/senri/ip の getIp で使う)
    // Bun の requestIP は元のリクエストでしか答えないので、c.req が差し替えられても元のほうで聞く
    // (Node のアダプターから来たときは、接続元は info にあるので req は読まれない)
    #original: Request;
    #info: unknown;

    static {
        connectionOf = (c) => ({ req: c.#original, info: c.#info });
        lazyContext = (source, info) => {
            const c = new LazyContext(source, info);
            // Request を作らなくても、ルーティングできるようにしておく
            c.#pathname = pathnameOf(source.url);
            return c;
        };
    }

    #ctx: ExecutionContext | undefined;

    /** Created by the app for each request; app code does not normally call it. The arguments are those of `app.fetch`. */
    constructor(req: Request, info?: unknown, ctx?: ExecutionContext) {
        this.req = req;
        this.#original = req;
        this.#info = info;
        this.#ctx = ctx;
    }

    // Cloudflare Workers の env(KV や環境変数などのバインディング)。型は createApp<{ Bindings: ... }>() で決める
    // Bun の server や Deno の info(接続元を知るためのもの)は env ではないので、そのときは undefined
    /**
     * The second argument of `app.fetch`: on Cloudflare Workers, the `env` bindings (typed with `createApp<{ Bindings: Env }>()`).
     * `undefined` when it is Bun's server or Deno-style connection info (Bun, Deno, `@senrijs/senri/node`).
     */
    get env(): BindingsOf<V> {
        return (isConnectionInfo(this.#info) ? undefined : this.#info) as BindingsOf<V>;
    }

    // Cloudflare Workers の ctx(waitUntil など)。Workers 以外では渡されないので、読むとエラーにする
    /** Cloudflare Workers' execution context (`waitUntil` and so on). Throws when it was not passed to `app.fetch`. */
    get executionCtx(): ExecutionContext {
        if (!this.#ctx) {
            throw senriError("no_execution_ctx", "c.executionCtx is only available on Cloudflare Workers");
        }
        return this.#ctx;
    }

    // パスをデコードして "/" で分けたもの。ルーターもミドルウェアもこれを見る
    // 初めて読んだときに1回だけ作る。エンコードが不正なら HttpError(400) を投げる
    /**
     * The decoded path split by `/`, without empty segments (`"/a//b/"` → `["a", "b"]`).
     * Throws an {@link HttpError} 400 for invalid encoding, `%2F`, or `.` / `..` segments.
     */
    get segments(): readonly string[] {
        this.#segments ??= splitPath(this.#rawPathname());
        return this.#segments;
    }

    // req.url から取り出したままの pathname(1回だけ取り出す)。おかしなリクエストなら HttpError(400) を投げる
    #rawPathname(): string {
        this.#pathname ??= requestPathname(this.req);
        return this.#pathname;
    }

    // 正規化・デコード済みのパス("//admin/" → "/admin"、"/%61dmin" → "/admin")
    // パスで判定するミドルウェアは、req.url ではなくこちらを使うこと
    /**
     * The normalized, decoded path (`"//admin/"` → `"/admin"`, `"/%61dmin"` → `"/admin"`).
     * Middleware that checks paths should use this, not `req.url`. Throws an {@link HttpError} 400 in the same cases as `segments`.
     */
    get path(): string {
        if (this.#path === undefined) {
            const p = this.#rawPathname();
            // エンコードも、連続・末尾のスラッシュもなければ、取り出したままのものと同じ(分割もつなぎ直しもしない)
            // ("." のセグメントは requestPathname が new URL() で解決済みなので、ここには来ない)
            const clean = !p.includes("%") && !p.includes("//") && (p.length === 1 || !p.endsWith("/"));
            this.#path = clean ? p : "/" + this.segments.join("/");
        }
        return this.#path;
    }

    // 開発モードのときだけ、ミドルウェアとハンドラーの通過時間が入る(外側から順)
    // 自分より内側の層は、next() が終わったあとに読める
    /**
     * Time spent in each middleware and the handler, outermost first. Filled only in development mode; empty otherwise.
     * Entries for inner layers are available after `next()` returns.
     */
    get timings(): Timing[] {
        return (this.#timings ??= []);
    }

    // ルートに渡したスキーマで確かめた値。c.valid("body") / c.valid("query")
    // (スキーマを渡していないものは型エラー。JS から呼んだときは、分かりやすいエラーにする)
    /**
     * A value validated by the route's schema: `c.valid("query")` or `c.valid("body")`.
     * Throws if the route has no schema for `target`.
     */
    valid<K extends keyof I & string>(target: K): I[K] {
        const values = validated.get(this);
        if (!values || !(target in values)) {
            throw senriError("no_valid", `c.valid("${target}"): no schema for ${target}`);
        }
        return values[target] as I[K];
    }

    // ミドルウェアからハンドラーへ値を渡す(ログインしたユーザーなど)
    /** Sets a variable for later middleware and the handler (the logged-in user, for example). */
    set<K extends keyof VariablesOf<V> & string>(key: K, value: VariablesOf<V>[K]): this {
        (this.#vars ??= new Map()).set(key, value);
        return this;
    }

    // set していなければ undefined(ミドルウェアが動かなかったときなど)
    /** Reads a variable set with {@link Context.set}, or `undefined` if it was not set. */
    get<K extends keyof VariablesOf<V> & string>(key: K): VariablesOf<V>[K] | undefined {
        return this.#vars?.get(key) as VariablesOf<V>[K] | undefined;
    }

    // --- クエリ ---

    #searchParams(): URLSearchParams {
        this.#query ??= new URL(this.req.url).searchParams;
        return this.#query;
    }

    // c.query("page") で1つ(なければ undefined)、c.query() で全部(同じ名前が複数あれば最後の値)
    /** All query parameters. For repeated names, the last value. */
    query(): Record<string, string>;
    /** One query parameter, or `undefined`. For repeated names, the last value. */
    query(name: string): string | undefined;
    /** One query parameter (with `name`), or all of them (without it). For repeated names, the last value. */
    query(name?: string): string | undefined | Record<string, string> {
        const params = this.#searchParams();
        if (name !== undefined) {
            const all = params.getAll(name);
            return all.length > 0 ? all[all.length - 1] : undefined;
        }
        return Object.fromEntries(params);
    }

    // 同じ名前のものを全部(?tag=a&tag=b → ["a", "b"])
    /** All values of a repeated query parameter (`?tag=a&tag=b` → `["a", "b"]`). */
    queries(name: string): string[] {
        return this.#searchParams().getAll(name);
    }

    // --- ボディ ---

    // Content-Type に合わせて読む(JSON / フォーム / テキスト / それ以外は ArrayBuffer。src/body.ts)
    // 一度読んだら覚えておくので、何度呼んでもよい
    /**
     * Reads the request body according to its `Content-Type`. The result is cached, so it can be called more than once.
     * - `application/json` and `*+json`: parsed JSON (invalid JSON throws an {@link HttpError} 400)
     * - `application/x-www-form-urlencoded` and `multipart/form-data`: a {@link FormBody}
     * - `text/*`: a string
     * - anything else: an `ArrayBuffer`
     *
     * `T` is not checked at runtime; use a `body` schema to validate.
     */
    body<T = unknown>(): Promise<T> {
        this.#body ??= readBody(this.req);
        return this.#body as Promise<T>;
    }

    /**
     * Sets the status for responses built from returned values, {@link Context.json}, {@link Context.text} and {@link Context.html}.
     * A `Response` returned directly and {@link Context.redirect} keep their own status.
     */
    status(code: number): this {
        this.#status = code;
        return this;
    }

    // ここで設定したヘッダーは、最後に finalize() で1回だけレスポンスに足される
    // なので、Response を直接返したときも、エラーのときも、next() のあとに設定しても効く
    /**
     * Sets a response header. Headers are added to the final response once, so they also apply to a `Response`
     * returned directly, to error responses, and when set after `next()`.
     * `Set-Cookie` is appended; other names are overwritten. A `Content-Type` or `Location` already on the response is kept.
     */
    header(name: string, value: string): this {
        // Set-Cookie は1つのレスポンスに何個も付けるものなので、上書きせずに足す
        const headers = (this.#headers ??= new Headers());
        if (name.toLowerCase() === "set-cookie") {
            headers.append(name, value);
        } else {
            headers.set(name, value);
        }
        return this;
    }

    // json() と text() と html() は Content-Type と status だけ決める(ほかのヘッダーは finalize() で足す)
    // 共有の #headers を書き換えないので、json() のあとに text() しても Content-Type が混ざらない
    /** A JSON response (`application/json`, unless `Content-Type` was set with {@link Context.header}). */
    json(data: unknown, status?: number): Response {
        const init = initOf(status ?? this.#status, this.#headers?.get("content-type"), JSON_HEADERS);
        return new Response(JSON.stringify(data), init);
    }

    /** A text response (`text/plain; charset=utf-8`, unless `Content-Type` was set with {@link Context.header}). */
    text(body: string, status?: number): Response {
        // 明示しないと、Bun は Headers に Content-Type を入れない(Node / Deno は入れる)のでランタイムで差が出る
        const init = initOf(status ?? this.#status, this.#headers?.get("content-type"), TEXT_HEADERS);
        return new Response(body, init);
    }

    /**
     * An HTML response (`text/html; charset=utf-8`, unless `Content-Type` was set with {@link Context.header}).
     * `body` is sent as is: escape anything that comes from users yourself.
     *
     * @example
     * ```ts
     * import { createApp } from "@senrijs/senri";
     *
     * const app = createApp();
     * app.get("/", (_, c) => c.html("<h1>Hello</h1>"));
     * app.get("/missing", (_, c) => c.html("<h1>Not here</h1>", 404));
     * ```
     */
    html(body: string, status?: number): Response {
        const init = initOf(status ?? this.#status, this.#headers?.get("content-type"), HTML_HEADERS);
        return new Response(body, init);
    }

    // Response.redirect() は絶対 URL しか受けないので使わない(/login のような相対パスも通す)
    // c.status() は見ない。リダイレクトでない status が混ざらないよう、引数だけで決める
    /**
     * A redirect with a `Location` header and no body. `location` can be a relative path or an absolute URL.
     * Headers set with {@link Context.header} are added as usual (`Set-Cookie` and so on), but `location` wins over a `Location` set there.
     * The status set with {@link Context.status} is not used.
     *
     * Non-ASCII characters are encoded, the same way on every runtime. In an absolute URL, `new URL(location).href` does this
     * (the host name becomes punycode); elsewhere only the non-ASCII characters are percent-encoded, so `%2F` stays as it is.
     *
     * Throws a `TypeError` if `status` is not a {@link RedirectStatus}, if `location` contains CR or LF,
     * or if it cannot be encoded (a lone surrogate in a relative location, or an absolute URL that `new URL` rejects).
     * Any other value is accepted, including other sites: check values that come from users (`c.query("next")`, for example) yourself.
     *
     * @example
     * ```ts
     * import { createApp } from "@senrijs/senri";
     * import { setCookie } from "@senrijs/senri/cookie";
     *
     * const app = createApp();
     * app.get("/old", (_, c) => c.redirect("/new", 301));
     * app.post("/login", (_, c) => {
     *     setCookie(c, "session", "abc");
     *     return c.redirect("/dashboard", 303);
     * });
     * ```
     */
    redirect(location: string, status: RedirectStatus = 302): Response {
        if (![301, 302, 303, 307, 308].includes(status)) {
            throw senriError("redirect_status", new TypeError(`Invalid redirect status: ${status} (use 301, 302, 303, 307 or 308)`));
        }
        return new Response(null, { status, headers: { location: toLocation(location) } });
    }

    // 例外で止めて、app の handleError(src/errors.ts)で notFound ハンドラーに回す
    // Context にハンドラーを持たせないので、使わないリクエストのコストは増えない
    /**
     * Stops here and responds with the app's 404: the handler set with `app.notFound`, or the default one.
     * Status 404 is set first, and headers set with {@link Context.header} are added to the response.
     * In a mounted app or router, this app's handler is used.
     *
     * Write `return c.notFound()`. It throws, so code after a bare `c.notFound();` does not run either,
     * but TypeScript only treats that form as stopping when `c` has an explicit type annotation.
     * With the usual `(_, c) =>`, a variable is not narrowed after it, and a handler that ends with it is a type error.
     *
     * It works like throwing an {@link HttpError} 404, except that it goes to the `notFound` handler and not to `onError`:
     * - An outer middleware's `await next()` does not throw; it returns the 404 response. Check `res.status`.
     * - A `try/catch` in the same function catches it. Rethrow it with `if (err instanceof HttpError) throw err`.
     *   To check for a 404, use `err instanceof HttpError && err.status === 404`.
     *
     * Inside the `notFound` handler, it responds with the default 404 instead of calling the handler again.
     * Inside `onError`, it gives the fixed 500, as any error thrown there does.
     *
     * @example
     * ```ts
     * import { createApp } from "@senrijs/senri";
     *
     * const items = new Map([["1", { name: "apple" }]]);
     *
     * const app = createApp();
     * app.notFound((c) => c.json({ error: "not found", path: c.path }));
     * app.get("/items/:id", ({ id }, c) => {
     *     const item = items.get(id);
     *     if (!item) return c.notFound();
     *     return item;
     * });
     * ```
     */
    notFound(): never {
        throw senriError("not_found", new HttpError(404, "404 Not Found"));
    }

    // c.header() で設定したヘッダーを res に足す。app が最後に1回だけ呼ぶ
    // - c.header() の値が優先。ただし Content-Type と Location はレスポンス自身のものが優先
    // - Set-Cookie は足す
    // - c.status() は使わない(Response を直接返したなら、その status を尊重する)
    /**
     * Adds the headers set with {@link Context.header} to `res`. Called once by the app at the end;
     * app code does not normally call it. Responses with a status below 200 are returned unchanged.
     */
    finalize(res: Response): Response {
        const own = this.#headers;
        // 何もなければ作り直さない。101(WebSocket のアップグレード)なども作り直すと壊れる
        if (own === undefined || res.status < 200) return res;
        let hasHeaders = false;
        own.forEach(() => (hasHeaders = true));
        if (!hasHeaders) return res;

        // fetch() や Response.redirect() の Response はヘッダーを変更できないので、新しく作る
        const headers = new Headers(res.headers);
        own.forEach((value, key) => {
            if (key === "set-cookie") return;
            if ((key === "content-type" || key === "location") && headers.has(key)) return;
            headers.set(key, value);
        });
        for (const cookie of own.getSetCookie()) {
            headers.append("set-cookie", cookie);
        }
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    /** Converts a {@link HandlerResult} to a `Response`. Used by the app; throws for functions, `undefined` and `null`. */
    toResponse(value: HandlerResult): Response {
        if (value instanceof Response) {
            return value;
        }
        if (typeof value === "string") {
            return this.text(value);
        }
        if (isBodyValue(value)) {
            const contentType = this.#headers?.get("content-type") ?? contentTypeOf(value);
            // headers: undefined は渡さない(exactOptionalPropertyTypes の利用者の型チェックで、エラーになるので)
            return new Response(
                value,
                contentType ? { status: this.#status, headers: { "content-type": contentType } } : { status: this.#status },
            );
        }
        // 型では防いでいるが、JS から使ったときや as で無理やり通したときのために実行時にも確かめる
        if (typeof value === "function") {
            throw senriError("returned_function", new TypeError("Handler returned a function"));
        }
        if (value === undefined || value === null) {
            throw senriError("returned_nothing", new TypeError("Handler returned undefined or null"));
        }
        return this.json(value);
    }
}

// Node のアダプターから来たリクエストの Context。c.req を読まないハンドラーでは、Request を作らない
// 渡すのは常に本物の Request。c.req.signal、new Request(c.req)、fetch(c.req)、c.req.clone() はそのまま動く
class LazyContext extends Context {
    #source: LazyRequest;
    #req: Request | undefined;

    constructor(source: LazyRequest, info: unknown) {
        super(undefined as never, info);
        this.#source = source;
    }

    // @ts-expect-error 親ではプロパティ。ここだけ、最初に読んだときに作る
    override get req(): Request {
        return (this.#req ??= this.#source.create());
    }

    override set req(value: Request) {
        // 親のコンストラクターの代入は、#req を初期化する前にここへ来るので、受け流す
        if (#req in this) this.#req = value;
    }
}
