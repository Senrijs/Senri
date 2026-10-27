import { Context, type ExecutionContext, type Handler, type HandlerResult, type Middleware } from "./context.ts";
import {
    allowedMethods,
    checkParamNames,
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
import { routeHandler, type RouteSchemas, type Validated, type ValidatedParams } from "./validate.ts";
import { groupEntries, joinPath, type GroupEntry, type Router } from "./group.ts";
import {
    defaultNotFound,
    defaultOnError,
    checkQueryRequest,
    handleError,
    HttpError,
    markConversionError,
    methodNotAllowed,
    senriError,
    type ErrorHandler,
    type NotFoundHandler,
} from "./errors.ts";

// リクエストをどう処理するかの結論。ミドルウェアより前に1回だけ決める
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
export type RouteMethod<V extends object> = {
    <Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>): void;
    <Path extends string, S extends RouteSchemas>(
        path: Path,
        schemas: S,
        handler: Handler<ValidatedParams<S, Simplify<ExtractParams<Path>>>, V, Validated<S>>,
    ): void;
};

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

// app.route(prefix, app) に渡せるもの(createApp() で作ったアプリ)
export type MountableApp = { routeList(): { method: string; path: string }[] };

// createApp() が返すアプリ
export type App<V extends object = Record<string, unknown>> = {
    use(pathOrMw: string | Middleware<V>, mw?: Middleware<V>): void;
    onError(handler: ErrorHandler<V>): void;
    notFound(handler: NotFoundHandler<V>): void;
    get: RouteMethod<V>;
    post: RouteMethod<V>;
    put: RouteMethod<V>;
    patch: RouteMethod<V>;
    delete: RouteMethod<V>;
    head: RouteMethod<V>;
    options: RouteMethod<V>;
    all: RouteMethod<V>;
    on: OnMethod<V>;
    routes<K extends string>(table: RouteTable<K, V>): void;
    route(routerOrPrefix: Router<string, V> | string, child?: MountableApp): void;
    middlewareList(): { name: string; path: string | null; anonymous: boolean }[];
    routeList(): { method: string; path: string }[];
    fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response>;
};

export type AppOptions = {
    // 開発モード。@senrijs/senri/dev の devtools() を渡す: createApp({ dev: devtools() })
    // 本体は開発用のコード(エラーページ・ダッシュボードなど)を一切 import しない。渡さなければバンドルにも入らない
    dev?: DevHooks;
};

// 開発用のフック。@senrijs/senri/dev の devtools() が作る(本体が知っているのは、この形だけ)
export type DevHooks = {
    // createApp() の最後に1回だけ呼ぶ。アプリの中身(core)を受け取って、開発モードの処理を返す
    install(core: AppCore): DevInstalled;
};

// 開発モードで使う、アプリの中身
export type AppCore = {
    app: App<any>;
    // ルートを決める / かかるミドルウェアを集める / いちばん内側の処理(本番の fetch と同じもの)
    resolve(c: Context): Resolved;
    layers(c: Context): Layer[];
    inner(c: Context, resolved: Resolved): Response | Promise<Response>;
    // いまの onError を通して、例外をレスポンスにする
    fail(err: unknown, c: Context): Promise<Response>;
    // 登録されたルート(登録順)
    routes(): readonly Route[];
};

export type DevInstalled = {
    // app.fetch の代わり(計測・エラーページ・ダッシュボードの記録など)
    fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response>;
    // 既定の onError / notFound(app.onError / app.notFound で替えたら、そちらを使う)
    onError: ErrorHandler;
    notFound: NotFoundHandler;
    // ルートを登録する前に確かめる(/_senri の予約、スキーマの書き間違い)
    checkRoute(method: string, path: string, schemas: RouteSchemas | undefined): void;
    // 登録時のエラーに、日本語の説明を付ける
    explain(err: unknown): unknown;
};

// 0.1 の createApp({ dev: true }) は使えなくなった。どう書き換えるかを案内する
const DEV_TRUE = `createApp({ dev: true }) is no longer supported. Use devtools() from "@senrijs/senri/dev".
createApp({ dev: true }) は使えなくなりました。@senrijs/senri/dev の devtools() を渡してください。

  import { createApp } from "@senrijs/senri";
  import { devtools } from "@senrijs/senri/dev";

  const app = createApp({ dev: devtools() });`;

// V はアプリの型。c.set / c.get で使う変数の型(createApp<{ user: User }>())か、
// Workers の env も含めた形(createApp<{ Bindings: Env; Variables: { user: User } }>())で指定する(src/context.ts)
export function createApp<V extends object = Record<string, unknown>>(options: AppOptions = {}): App<V> {
    if ((options.dev as unknown) === true) throw senriError("dev_true", DEV_TRUE);
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

    function add(rawMethod: string, path: string, handler: Handler, schemas?: RouteSchemas) {
        // app.all() の印の "ALL" だけはそのまま。ほかは名前を確かめて大文字にする
        const method = rawMethod === "ALL" ? rawMethod : normalizeMethod(rawMethod);
        devHooks?.checkRoute(method, path, schemas);
        const segments = splitPattern(path);
        checkParamNames(path, segments);

        // 同じメソッド + 同じ形のパスがあったら、あとから登録したほうは絶対に呼ばれないのでエラーにする
        const shape = routeShape(segments);
        const dup = routes.find((r) => r.method === method && routeShape(r.segments) === shape);
        if (dup) throw senriError("route_duplicate", `Duplicate route: ${method} ${path} (already: ${dup.method} ${dup.path})`);

        const paramNames = segments.filter((s) => s.startsWith(":")).map((s) => s.slice(1));
        const route: Route = { path, segments, paramNames, method, handler };
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

    function resolve(c: Context): Resolved {
        let path: string;
        try {
            path = c.path;
        } catch (error) {
            // エンコードが不正(HttpError 400)。ミドルウェアは動かしてから返す
            return { kind: "badRequest", error };
        }
        const method = c.req.method;
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

        // どれもなければ、パスが合うルートを全部集めて 404 か 405 かを決める
        const matched = matcher.match(segments);
        if (matched.length === 0) return { kind: "notFound" };
        const allow = allowedMethods(matched.flatMap((x) => x.leaf));
        return method === "OPTIONS" ? { kind: "options", allow } : { kind: "methodNotAllowed", allow };
    }

    // ミドルウェアがないときに毎回配列を作らないよう、共有の空配列を返す(中身は変えない)
    const NO_LAYERS: Layer[] = [];

    function applicableMiddlewares(c: Context): Layer[] {
        if (middlewares.length === 0) return NO_LAYERS;
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
        return layers;
    }

    const app: App<V> = {
        use: guard((pathOrMw: string | Middleware<V>, mw?: Middleware<V>) => {
            const path = typeof pathOrMw === "string" ? pathOrMw : null;
            const fn = typeof pathOrMw === "string" ? mw : pathOrMw;
            if (!fn) throw senriError("no_middleware", `Missing middleware: ${path}`);

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
        routes: guard(<K extends string>(table: RouteTable<K, V>) => {
            for (const [key, handler] of Object.entries(table) as [string, Handler][]) {
                const [method, path] = key.split(" ");
                if (!method || !path) throw senriError("route_key", `Invalid route key: "${key}" (e.g. "GET /hello")`);
                add(method.toUpperCase(), path, handler);
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
                const resolved = resolve(c);
                if (resolved.kind === "route") {
                    c.route = resolved.route.path;
                    c.params = resolved.params;
                }
                const fail = (err: unknown) => handleError(err, c, onError);
                const layers = applicableMiddlewares(c);
                if (layers.length > 0) {
                    return compose(layers, c, () => inner(c, resolved), fail).then((res) => c.finalize(res));
                }
                // 近道: ミドルウェアがなければ compose を通さない。同期のハンドラーなら、待たずにそのまま返す
                let res: Response | Promise<Response>;
                try {
                    res = inner(c, resolved);
                } catch (err) {
                    res = fail(err);
                }
                if (res instanceof Promise) return res.catch(fail).then((r) => c.finalize(r));
                return Promise.resolve(c.finalize(res));
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
                c.status(404);
                return Promise.resolve(notFound(c)).then((value) => c.toResponse(value));
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

    // 開発モード: 中身を渡して、開発用の fetch と既定の onError / notFound を受け取る
    if (options.dev) {
        devHooks = options.dev.install({
            app,
            resolve,
            layers: applicableMiddlewares,
            inner: inner as AppCore["inner"],
            fail: (err, c) => handleError(err, c, onError),
            routes: () => routes,
        });
        onError = devHooks.onError;
        notFound = devHooks.notFound;
    }

    return app;
}
