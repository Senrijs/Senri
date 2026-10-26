import { Context, type Handler, type Middleware } from "./context.ts";
import {
    compareRoutes,
    matchPath,
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
import { compose, toResponseOf, type Layer } from "./compose.ts";
import { groupEntries, joinPath, type GroupEntry, type Router } from "./group.ts";
import {
    defaultNotFound,
    defaultOnError,
    checkQueryRequest,
    handleError,
    HttpError,
    methodNotAllowed,
    type ErrorHandler,
    type NotFoundHandler,
} from "./errors.ts";

// リクエストをどう処理するかの結論。ミドルウェアより前に1回だけ決める
type Resolved =
    | { kind: "route"; route: Route; params: Record<string, string> }
    | { kind: "options"; allow: string }
    | { kind: "methodNotAllowed"; allow: string }
    | { kind: "notFound" }
    | { kind: "notImplemented" }
    | { kind: "badRequest"; error: unknown };

// パスが /_senri か /_senri/... なら、"_senri" より後ろのセグメント。そうでなければ null
function underDashboard(c: Context): readonly string[] | null {
    try {
        return c.segments[0] === "_senri" ? c.segments.slice(1) : null;
    } catch {
        return null;
    }
}

// 計測で、いちばん内側の層に付ける名前(ダッシュボードの玉ねぎタイムラインに出る)
const INNER_NAME: Record<Resolved["kind"], string> = {
    route: "handler",
    notFound: "notFound",
    methodNotAllowed: "405",
    options: "options",
    badRequest: "400",
    notImplemented: "501",
};

// 扱わないメソッド。ルートがあってもなくても 501 にする(app.all() でも受けない)
const NOT_IMPLEMENTED = new Set(["CONNECT", "TRACE", "TRACK"]);

// app.route(prefix, app) でつなげるように、アプリに登録されたものを横に置いておく
const appEntries = new WeakMap<object, () => GroupEntry[]>();

// app.route(prefix, app) に渡せるもの(createApp() で作ったアプリ)
export type MountableApp = { routeList(): { method: string; path: string }[] };

export type AppOptions = {
    // 開発モード。エラーの詳細や「もしかして」を返す。本番では絶対にオンにしない
    // 環境変数からは読まない(Deno では --allow-env がないと読めない、などランタイム差があるため)
    dev?: boolean;
};

// V は c.set / c.get で使う変数の型。createApp<{ user: User }>() のように指定する
export function createApp<V extends object = Record<string, unknown>>(options: AppOptions = {}) {
    const dev = options.dev ?? false;
    const routes: Route[] = [];
    // prefix が null なら全部のリクエストで動く。["admin"] なら /admin とその下だけ
    // anonymous: 無名の関数だった(名前を anonymous#番号 にした)。ダッシュボードで「名前を付けると出る」と案内する
    const middlewares: { name: string; anonymous: boolean; path: string | null; prefix: string[] | null; mw: Middleware<V> }[] = [];
    // 開発モードだけで使うもの(エラーページ、ダッシュボード)。ビルド済みの HTML など大きいので、
    // 本番では読み込まないよう dev のときだけ import() する(src/dev/index.ts)
    const devTools = dev ? import("./dev/index.ts") : null;
    // 開発モードでは、ブラウザから開いた 5xx を HTML のエラーページにする(src/dev/pages.ts)
    const baseOnError = defaultOnError(dev);
    let onError: ErrorHandler<V> = devTools
        ? async (err, c) => (await devTools).withErrorPage(baseOnError, true)(err, c)
        : baseOnError;
    let notFound: NotFoundHandler<V> = defaultNotFound(routes, dev);

    function add(rawMethod: string, path: string, handler: Handler) {
        // app.all() の印の "ALL" だけはそのまま。ほかは名前を確かめて大文字にする
        const method = rawMethod === "ALL" ? rawMethod : normalizeMethod(rawMethod);
        const segments = splitPattern(path);
        checkParamNames(path, segments);
        // 開発モードでは /_senri 以下はダッシュボードが使うので、登録しても呼ばれない。気づけるようにエラーにする
        if (dev && segments[0] === "_senri") {
            throw new Error(`${method} ${path}: /_senri 以下は、開発モードではダッシュボード用に予約されています`);
        }

        // 同じメソッド + 同じ形のパスがあったら、あとから登録したほうは絶対に呼ばれないのでエラーにする
        const shape = routeShape(segments);
        const dup = routes.find((r) => r.method === method && routeShape(r.segments) === shape);
        if (dup) {
            const samePath = dup.segments.join("/") === segments.join("/");
            throw new Error(
                samePath
                    ? `${method} ${path} はすでに登録されています`
                    : `${method} ${path} は、登録済みの ${dup.method} ${dup.path} と同じパスです(パラメーター名が違うだけです)`,
            );
        }

        routes.push({ path, segments, method, handler });
        routes.sort(compareRoutes);
    }

    function resolve(c: Context): Resolved {
        let segments: readonly string[];
        try {
            segments = c.segments;
        } catch (error) {
            // エンコードが不正(HttpError 400)。ミドルウェアは動かしてから返す
            return { kind: "badRequest", error };
        }
        const method = c.req.method;
        if (NOT_IMPLEMENTED.has(method)) return { kind: "notImplemented" };

        // パスが合うルートを、優先順位の順に集める(メソッドはまだ見ない)
        const matched: { route: Route; params: Record<string, string> }[] = [];
        for (const route of routes) {
            const params = matchPath(route.segments, segments);
            if (params !== null) matched.push({ route, params });
        }
        const find = (m: string) => matched.find((x) => x.route.method === m);

        // 1. メソッドが合うもの → 2. HEAD なら GET → 3. all の順に探す
        const hit = find(method) ?? (method === "HEAD" ? find("GET") : undefined) ?? find("ALL");
        if (hit) return { kind: "route", ...hit };

        if (matched.length === 0) return { kind: "notFound" };
        const allow = allowedMethods(matched.map((x) => x.route));
        return method === "OPTIONS" ? { kind: "options", allow } : { kind: "methodNotAllowed", allow };
    }

    function applicableMiddlewares(c: Context): Layer[] {
        let segments: readonly string[] | null;
        try {
            segments = c.segments;
        } catch {
            // パスが不正なら、パス指定のミドルウェアは動かさない(どのみちルーターが 400 にする)
            segments = null;
        }
        return (
            middlewares
                // order は登録順(1 から)。同じ関数を2回登録しても区別できるよう、配列の位置から決める
                // (ダッシュボードで、名前ではなく登録順で集計するのに使う)
                .map(({ name, mw, prefix }, i) => ({ name, mw, prefix, order: i + 1 }))
                .filter(({ prefix }) => prefix === null || (segments !== null && startsWithSegments(segments, prefix)))
                .map(({ name, mw, order }) => ({ name, mw, order }))
        );
    }

    const app = {
        use(pathOrMw: string | Middleware<V>, mw?: Middleware<V>) {
            const path = typeof pathOrMw === "string" ? pathOrMw : null;
            const fn = typeof pathOrMw === "string" ? mw : pathOrMw;
            if (!fn) throw new Error(`app.use("${path}", ...) にミドルウェアがありません`);

            middlewares.push({
                // 関数の名前を使う。無名の関数(その場で書いたアロー関数など)は登録順の番号で呼ぶ
                name: fn.name || `anonymous#${middlewares.length + 1}`,
                anonymous: !fn.name,
                path,
                prefix: path === null ? null : splitPattern(path),
                mw: fn,
            });
        },

        onError(handler: ErrorHandler<V>) {
            onError = handler;
        },

        notFound(handler: NotFoundHandler<V>) {
            notFound = handler;
        },

        get<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("GET", path, handler as Handler);
        },

        post<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("POST", path, handler as Handler);
        },

        put<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("PUT", path, handler as Handler);
        },

        patch<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("PATCH", path, handler as Handler);
        },

        delete<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("DELETE", path, handler as Handler);
        },

        // 登録しなければ GET を使う(ボディは送らない)。登録すれば GET より優先される
        head<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("HEAD", path, handler as Handler);
        },

        // 登録しなければ 204 と Allow を自動で返す。登録すればそちらが優先される
        options<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("OPTIONS", path, handler as Handler);
        },

        // 任意のメソッド(QUERY や、PROPFIND などの WebDAV)を登録する。配列でまとめて登録もできる
        // 小文字で書いても大文字にする。CONNECT / TRACE / TRACK は扱わない
        on<Path extends string>(
            method: string | readonly string[],
            path: Path,
            handler: Handler<Simplify<ExtractParams<Path>>, V>,
        ) {
            const methods = typeof method === "string" ? [method] : method;
            if (methods.length === 0) throw new Error(`app.on(..., "${path}") にメソッドがありません`);
            for (const m of methods) {
                if (m.toUpperCase() === "ALL") throw new Error("すべてのメソッドで動かすには app.all() を使ってください");
                add(m, path, handler as Handler);
            }
        },

        // どのメソッドでも動く。ただし、メソッドが合うルートがあればそちらが優先
        all<Path extends string>(path: Path, handler: Handler<Simplify<ExtractParams<Path>>, V>) {
            add("ALL", path, handler as Handler);
        },

        // K はテーブルのキーから推論される。各キーのパスからパラメーターの型が決まる
        routes<K extends string>(table: RouteTable<K, V>) {
            for (const [key, handler] of Object.entries(table) as [string, Handler][]) {
                const [method, path] = key.split(" ");
                if (!method || !path) {
                    throw new Error(`ルートの書き方が違います: "${key}"\n例: "GET /hello"`);
                }

                add(method.toUpperCase(), path, handler);
            }
        },

        // createRouter() で作ったルーターをつなげる。ルーターに登録済みのものが、この時点でアプリに入る
        // app.route(prefix, app) なら、別のアプリをプレフィックス付きでつなげる
        // (つなぐ側のアプリでは、プレフィックスのパラメーターに型は付かない。型が必要なら createRouter を使う)
        // つないだアプリの onError / notFound は使わず、こちらのものを使う
        route(routerOrPrefix: Router<string, V> | string, child?: MountableApp) {
            // 先に全部読んでおく(ルーターの作りがおかしいときに、途中まで登録された状態にしない)
            let list: GroupEntry[];
            if (typeof routerOrPrefix === "string") {
                const read = child ? appEntries.get(child) : undefined;
                if (!read) throw new TypeError(`app.route("${routerOrPrefix}", app) には createApp() で作ったアプリを渡してください`);
                list = read().map((entry) => ({ ...entry, path: joinPath(routerOrPrefix, entry.path) }));
            } else {
                list = groupEntries(routerOrPrefix);
            }
            for (const entry of list) {
                if (entry.kind === "use") app.use(entry.path, entry.mw);
                else add(entry.method, entry.path, entry.handler);
            }
        },

        middlewareList() {
            return middlewares.map((m) => ({ name: m.name, path: m.path, anonymous: m.anonymous }));
        },

        routeList() {
            return routes.map((r) => ({ method: r.method, path: r.path }));
        },

        // info: ランタイムが渡す2つ目の引数(Bun の server、Deno の info など)。接続元のアドレスを取るのに使う
        // (形で見分けるので、Cloudflare Workers の env のような別のものが来ても壊れない。src/dev/dashboard/access.ts)
        async fetch(req: Request, info?: unknown): Promise<Response> {
            // 開発モードのときだけ、計測の基準になるリクエストの開始時刻を取る
            const origin = dev ? performance.now() : 0;
            const time = dev ? Date.now() : 0;
            const c = new Context<V>(req);
            const dashboard = dashboardPromise ? await dashboardPromise : null;
            // /_senri 以下はダッシュボード。localhost から開いたときだけ、ミドルウェアを通さずに処理する
            // (開けないときは普通の処理に回すので、/_senri はないものとして 404 になる)。どちらも記録はしない
            const dashboardPath = dashboard ? underDashboard(c) : null;
            if (dashboard && dashboardPath && dashboard.canOpen(req, info)) {
                return dashboard.handle(req, dashboardPath);
            }
            if (!dashboardPath) dashboard?.begin(c, info);
            const fail = (err: unknown) => handleError(err, c, onError);

            // ミドルウェアより先にマッチして、c.route / c.params を見られるようにしておく
            const resolved = resolve(c);
            if (resolved.kind === "route") {
                c.route = resolved.route.path;
                c.params = resolved.params;
            }

            // ミドルウェアを全部通ったあとに動く、いちばん内側の処理
            const run = async (): Promise<Response> => {
                switch (resolved.kind) {
                    case "badRequest":
                        throw resolved.error;
                    case "route": {
                        // QUERY として登録したルートだけ、ボディと Content-Type を確かめる(app.all はハンドラーに任せる)
                        if (resolved.route.method === "QUERY") {
                            const invalid = await checkQueryRequest(c, dev);
                            if (invalid) throw invalid;
                        }
                        const result = await resolved.route.handler(c.params, c);
                        const res = toResponseOf(c, result, {
                            kind: "handler",
                            name: `${resolved.route.method} ${resolved.route.path}`,
                        });
                        if (req.method !== "HEAD") return res;
                        // HEAD はヘッダーと status だけ返す(ボディは捨てる)
                        await res.body?.cancel();
                        return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
                    }
                    case "options":
                        return new Response(null, { status: 204, headers: { allow: resolved.allow } });
                    case "methodNotAllowed":
                        throw methodNotAllowed(c, c.path, resolved.allow, dev);
                    case "notImplemented":
                        throw new HttpError(501, "501 Not Implemented");
                    case "notFound":
                        c.status(404);
                        return c.toResponse(await notFound(c));
                }
            };

            // ハンドラー・notFound・toResponse のどこで投げても、compose が onError に集める
            // 開発モードのときだけ計測する(本番では performance.now() の分も払わない)
            const layers = applicableMiddlewares(c);
            const innerName = INNER_NAME[resolved.kind];
            const measure = dev ? { timings: c.timings, origin, innerName } : undefined;
            const res = await compose(layers, c, run, fail, measure);
            // ミドルウェアを全部通ったあとなので、ここなら「通った順番」が揃っている
            const page = devTools ? await (await devTools).finishErrorPage(c, res) : res;
            const final = c.finalize(page);
            // 開発モードでは、ダッシュボードに記録する(失敗してもレスポンスには影響しない)
            await dashboard?.record(c, final, time, [
                ...layers.map((l) => ({ name: l.name, order: l.order ?? null })),
                { name: innerName, order: null },
            ]);
            return final;
        },
    };

    // ミドルウェアを先に(登録順のまま)、ルートはそのあと。ルートの順番は add() が並べ直すので関係ない
    appEntries.set(app, () => [
        ...middlewares.map((m): GroupEntry => ({ kind: "use", path: m.path ?? "/", mw: m.mw as Middleware })),
        ...routes.map((r): GroupEntry => ({ kind: "route", method: r.method, path: r.path, handler: r.handler })),
    ]);

    // 開発モードでは、ダッシュボードを作ってアプリに結び付けておく
    const dashboardPromise = devTools?.then((m) => {
        const dashboard = m.createDashboard({
            routes: () => app.routeList(),
            middlewares: () => app.middlewareList(),
        });
        m.registerDashboard(app, dashboard);
        return dashboard;
    });

    return app;
}
