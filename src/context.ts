import { splitPath } from "./router.ts";

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

export type Handler<P = Record<string, string>> = (
    params: P,
    c: Context,
) => HandlerResult | Promise<HandlerResult>;

export type Next = () => Promise<Response>;

export type Middleware = (
    c: Context,
    next: Next,
) => HandlerResult | void | Promise<HandlerResult | void>;

export class Context {
    req: Request;
    #status = 200;
    #headers = new Headers();
    #segments: string[] | undefined;
    error: unknown = undefined;
    // マッチしたルートのパターン("/users/:id")。見つからなければ undefined
    // ミドルウェアより先にマッチするので、next() の前から読める(ログやダッシュボードの集計用)
    route: string | undefined = undefined;
    // パスパラメーター。ハンドラーでは第1引数でも受け取れる
    params: Record<string, string> = {};

    constructor(req: Request) {
        this.req = req;
    }

    // パスをデコードして "/" で分けたもの。ルーターもミドルウェアもこれを見る
    // 初めて読んだときに1回だけ作る。エンコードが不正なら HttpError(400) を投げる
    get segments(): readonly string[] {
        this.#segments ??= splitPath(new URL(this.req.url).pathname);
        return this.#segments;
    }

    // 正規化・デコード済みのパス("//admin/" → "/admin"、"/%61dmin" → "/admin")
    // パスで判定するミドルウェアは、req.url ではなくこちらを使うこと
    get path(): string {
        return "/" + this.segments.join("/");
    }

    status(code: number) {
        this.#status = code;
        return this;
    }

    // ここで設定したヘッダーは、最後に finalize() で1回だけレスポンスに足される
    // なので、Response を直接返したときも、エラーのときも、next() のあとに設定しても効く
    header(name: string, value: string) {
        // Set-Cookie は1つのレスポンスに何個も付けるものなので、上書きせずに足す
        if (name.toLowerCase() === "set-cookie") {
            this.#headers.append(name, value);
        } else {
            this.#headers.set(name, value);
        }
        return this;
    }

    // json() と text() は Content-Type と status だけ決める(ほかのヘッダーは finalize() で足す)
    // 共有の #headers を書き換えないので、json() のあとに text() しても Content-Type が混ざらない
    json(data: unknown, status?: number): Response {
        return new Response(JSON.stringify(data), {
            status: status ?? this.#status,
            headers: { "content-type": this.#headers.get("content-type") ?? "application/json" },
        });
    }

    text(body: string, status?: number): Response {
        // 明示しないと、Bun は Headers に Content-Type を入れない(Node / Deno は入れる)のでランタイムで差が出る
        return new Response(body, {
            status: status ?? this.#status,
            headers: { "content-type": this.#headers.get("content-type") ?? "text/plain; charset=utf-8" },
        });
    }

    // c.header() で設定したヘッダーを res に足す。app が最後に1回だけ呼ぶ
    // - c.header() の値が優先。ただし Content-Type だけはレスポンス自身のものが優先
    // - Set-Cookie は足す
    // - c.status() は使わない(Response を直接返したなら、その status を尊重する)
    finalize(res: Response): Response {
        let hasHeaders = false;
        this.#headers.forEach(() => (hasHeaders = true));
        // 何もなければ作り直さない。101(WebSocket のアップグレード)なども作り直すと壊れる
        if (!hasHeaders || res.status < 200) return res;

        // fetch() や Response.redirect() の Response はヘッダーを変更できないので、新しく作る
        const headers = new Headers(res.headers);
        this.#headers.forEach((value, key) => {
            if (key === "set-cookie") return;
            if (key === "content-type" && headers.has(key)) return;
            headers.set(key, value);
        });
        for (const cookie of this.#headers.getSetCookie()) {
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
            const contentType = this.#headers.get("content-type") ?? contentTypeOf(value);
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
