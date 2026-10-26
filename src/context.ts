import { requestPathname, splitPath } from "./router.ts";
import { clientIp } from "./connection.ts";
import type { Timing } from "./compose.ts";
import { readBody } from "./body.ts";
import { deletionCookie, parseCookies, serializeCookie, type CookieOptions } from "./cookie.ts";

// そのままレスポンスのボディにできるもの(JSON にはしない)
// TypedArray は SharedArrayBuffer のもの以外(Response のボディにできないので)
export type BodyValue = Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer> | ReadableStream | FormData | URLSearchParams;

// JSON にするオブジェクト。関数(call を持つ)と Promise(then を持つ)は object でもあるので、ここで外す
// 関数を返すのはたいてい呼び忘れ、Promise は二重に包んでしまったときに起きる
export type JsonObject = object & { call?: never; then?: never };

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

// c.text() / c.json() の既定の Content-Type。Response は渡された Headers をコピーして使うので、共有してよい
// (オブジェクトリテラルを渡すより速い。毎回 Headers に変換しなくて済むため)
const TEXT_HEADERS = new Headers({ "content-type": "text/plain; charset=utf-8" });
const JSON_HEADERS = new Headers({ "content-type": "application/json" });
// status が 200 のときは init も共有する(毎回オブジェクトを作らない)
const TEXT_INIT = { status: 200, headers: TEXT_HEADERS };
const JSON_INIT = { status: 200, headers: JSON_HEADERS };

function initOf(status: number, type: string | null | undefined, headers: Headers, shared: ResponseInit): ResponseInit {
    if (type) return { status, headers: { "content-type": type } };
    return status === 200 ? shared : { status, headers };
}

// V は c.set / c.get で使う変数の型(createApp<{ user: User }>() のように決める)
// 既定の any は「どのアプリでも使える」という意味。logger() のような汎用ミドルウェアのため
export type Handler<P = Record<string, string>, V extends object = any> = (
    params: P,
    c: Context<V>,
) => HandlerResult | Promise<HandlerResult>;

export type Next = () => Promise<Response>;

export type Middleware<V extends object = any> = (
    c: Context<V>,
    next: Next,
) => HandlerResult | void | Promise<HandlerResult | void>;

export class Context<V extends object = any> {
    req: Request;
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
    #cookies: Record<string, string> | undefined;
    error: unknown = undefined;
    // マッチしたルートのパターン("/users/:id")。見つからなければ undefined
    // ミドルウェアより先にマッチするので、next() の前から読める(ログやダッシュボードの集計用)
    route: string | undefined = undefined;
    // パスパラメーター。ハンドラーでは第1引数でも受け取れる
    params: Record<string, string> = {};
    #timings: Timing[] | undefined;

    // app.fetch に渡された元のリクエストと2つ目の引数(c.ip で使う)
    // Bun の requestIP は元のリクエストでしか答えないので、c.req が差し替えられても元のほうで聞く
    #original: Request;
    #info: unknown;
    #ip: string | null | undefined;

    constructor(req: Request, info?: unknown) {
        this.req = req;
        this.#original = req;
        this.#info = info;
    }

    // 接続元の IP アドレス。分からなければ null(Cloudflare Workers や、app.fetch を直接呼んだときなど)
    // X-Forwarded-For などのヘッダーは偽装できるので読まない。プロキシの後ろでは、プロキシが付けるヘッダーを自分で読む
    get ip(): string | null {
        if (this.#ip === undefined) this.#ip = clientIp(this.#original, this.#info);
        return this.#ip;
    }

    // パスをデコードして "/" で分けたもの。ルーターもミドルウェアもこれを見る
    // 初めて読んだときに1回だけ作る。エンコードが不正なら HttpError(400) を投げる
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
    get timings(): Timing[] {
        return (this.#timings ??= []);
    }

    // ミドルウェアからハンドラーへ値を渡す(ログインしたユーザーなど)
    set<K extends keyof V & string>(key: K, value: V[K]) {
        (this.#vars ??= new Map()).set(key, value);
        return this;
    }

    // set していなければ undefined(ミドルウェアが動かなかったときなど)
    get<K extends keyof V & string>(key: K): V[K] | undefined {
        return this.#vars?.get(key) as V[K] | undefined;
    }

    // --- クエリ ---

    #searchParams(): URLSearchParams {
        this.#query ??= new URL(this.req.url).searchParams;
        return this.#query;
    }

    // c.query("page") で1つ(なければ undefined)、c.query() で全部(同じ名前が複数あれば最後の値)
    query(): Record<string, string>;
    query(name: string): string | undefined;
    query(name?: string): string | undefined | Record<string, string> {
        const params = this.#searchParams();
        if (name !== undefined) {
            const all = params.getAll(name);
            return all.length > 0 ? all[all.length - 1] : undefined;
        }
        return Object.fromEntries(params);
    }

    // 同じ名前のものを全部(?tag=a&tag=b → ["a", "b"])
    queries(name: string): string[] {
        return this.#searchParams().getAll(name);
    }

    // --- ボディ ---

    // Content-Type に合わせて読む(JSON / フォーム / テキスト / それ以外は ArrayBuffer。src/body.ts)
    // 一度読んだら覚えておくので、何度呼んでもよい
    body<T = unknown>(): Promise<T> {
        this.#body ??= readBody(this.req);
        return this.#body as Promise<T>;
    }

    // --- Cookie ---

    cookie(): Record<string, string>;
    cookie(name: string): string | undefined;
    cookie(name?: string): string | undefined | Record<string, string> {
        this.#cookies ??= parseCookies(this.req.headers.get("cookie"));
        return name === undefined ? { ...this.#cookies } : this.#cookies[name];
    }

    // 既定は Path=/・HttpOnly・SameSite=Lax(src/cookie.ts)
    setCookie(name: string, value: string, options?: CookieOptions) {
        this.header("set-cookie", serializeCookie(name, value, options));
        return this;
    }

    // Path と Domain は、付けたときと同じものを指定する
    deleteCookie(name: string, options?: Pick<CookieOptions, "path" | "domain">) {
        this.header("set-cookie", deletionCookie(name, options));
        return this;
    }

    status(code: number) {
        this.#status = code;
        return this;
    }

    // ここで設定したヘッダーは、最後に finalize() で1回だけレスポンスに足される
    // なので、Response を直接返したときも、エラーのときも、next() のあとに設定しても効く
    header(name: string, value: string) {
        // Set-Cookie は1つのレスポンスに何個も付けるものなので、上書きせずに足す
        const headers = (this.#headers ??= new Headers());
        if (name.toLowerCase() === "set-cookie") {
            headers.append(name, value);
        } else {
            headers.set(name, value);
        }
        return this;
    }

    // json() と text() は Content-Type と status だけ決める(ほかのヘッダーは finalize() で足す)
    // 共有の #headers を書き換えないので、json() のあとに text() しても Content-Type が混ざらない
    json(data: unknown, status?: number): Response {
        const init = initOf(status ?? this.#status, this.#headers?.get("content-type"), JSON_HEADERS, JSON_INIT);
        return new Response(JSON.stringify(data), init);
    }

    text(body: string, status?: number): Response {
        // 明示しないと、Bun は Headers に Content-Type を入れない(Node / Deno は入れる)のでランタイムで差が出る
        const init = initOf(status ?? this.#status, this.#headers?.get("content-type"), TEXT_HEADERS, TEXT_INIT);
        return new Response(body, init);
    }

    // c.header() で設定したヘッダーを res に足す。app が最後に1回だけ呼ぶ
    // - c.header() の値が優先。ただし Content-Type だけはレスポンス自身のものが優先
    // - Set-Cookie は足す
    // - c.status() は使わない(Response を直接返したなら、その status を尊重する)
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
            if (key === "content-type" && headers.has(key)) return;
            headers.set(key, value);
        });
        for (const cookie of own.getSetCookie()) {
            headers.append("set-cookie", cookie);
        }
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    toResponse(value: HandlerResult): Response {
        if (value instanceof Response) {
            return value;
        }
        if (typeof value === "string") {
            return this.text(value);
        }
        if (isBodyValue(value)) {
            const contentType = this.#headers?.get("content-type") ?? contentTypeOf(value);
            return new Response(value, {
                status: this.#status,
                headers: contentType ? { "content-type": contentType } : undefined,
            });
        }
        // 型では防いでいるが、JS から使ったときや as で無理やり通したときのために実行時にも確かめる
        if (typeof value === "function") {
            throw new TypeError("ハンドラーが関数を返しました。呼び出し忘れではありませんか？");
        }
        if (value === undefined || value === null) {
            throw new TypeError("ハンドラーが何も返していません(undefined / null)");
        }
        return this.json(value);
    }
}
