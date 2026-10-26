// ルートのグループ化。プレフィックスは createRouter のときに決める
// (あとから app.route("/users/:id", router) のように付ける形だと、中のハンドラーで id の型が分からないため)
import type { Handler, Middleware } from "./context.ts";
import { normalizeMethod, splitPattern, type ExtractParams, type Simplify } from "./router.ts";
import { checkSchemas, withValidation, type RouteSchemas, type Validated, type ValidatedParams } from "./validate.ts";

// 2つ目の引数がスキーマなら、確かめてからハンドラーを呼ぶものにする(app.ts と同じ)
export function routeHandler(path: string, a: Handler | RouteSchemas, b: Handler | undefined): Handler {
    if (typeof a === "function") return a;
    if (typeof b !== "function") throw new TypeError(`${path}: ハンドラーがありません`);
    checkSchemas(path, a);
    return withValidation(a, b);
}

// プレフィックスとパスをつないだときのパラメーター。"/" を挟むので、"posts" のように "/" なしで書いてもよい
type GroupParams<Prefix extends string, Path extends string> = Simplify<ExtractParams<`${Prefix}/${Path}`>>;

// router.get(path, handler) と、スキーマを付けた router.get(path, { params, query, body }, handler)
type GroupMethod<Prefix extends string, V extends object> = {
    <Path extends string>(path: Path, handler: Handler<GroupParams<Prefix, Path>, V>): void;
    <Path extends string, S extends RouteSchemas>(
        path: Path,
        schemas: S,
        handler: Handler<ValidatedParams<S, GroupParams<Prefix, Path>>, V, Validated<S>>,
    ): void;
};

export type Router<Prefix extends string = string, V extends object = any> = {
    readonly prefix: Prefix;
    // プレフィックスの下だけで動くミドルウェア。パスを付けると、さらにその下だけ
    use(pathOrMw: string | Middleware<V>, mw?: Middleware<V>): void;
    get: GroupMethod<Prefix, V>;
    post: GroupMethod<Prefix, V>;
    put: GroupMethod<Prefix, V>;
    patch: GroupMethod<Prefix, V>;
    delete: GroupMethod<Prefix, V>;
    all: GroupMethod<Prefix, V>;
    head: GroupMethod<Prefix, V>;
    options: GroupMethod<Prefix, V>;
    on<Path extends string>(
        method: string | readonly string[],
        path: Path,
        handler: Handler<GroupParams<Prefix, Path>, V>,
    ): void;
    on<Path extends string, S extends RouteSchemas>(
        method: string | readonly string[],
        path: Path,
        schemas: S,
        handler: Handler<ValidatedParams<S, GroupParams<Prefix, Path>>, V, Validated<S>>,
    ): void;
    // ルーターの中にルーターをつなげる。中のルーターのプレフィックスは、このルーターからの相対パス
    route(router: Router<string, V>): void;
};

// 登録された順番のまま、app.route のときにアプリへ流し込む
export type GroupEntry =
    | { kind: "route"; method: string; path: string; handler: Handler }
    | { kind: "use"; path: string; mw: Middleware };

const entries = new WeakMap<Router, (prefix: string) => GroupEntry[]>();

export function joinPath(...parts: string[]): string {
    return "/" + parts.flatMap(splitPattern).join("/");
}

// ルーターに登録されたものを、プレフィックスを付けたパスで返す
export function groupEntries(router: Router): GroupEntry[] {
    const list = entries.get(router);
    if (!list) throw new TypeError("app.route() には createRouter() で作ったルーターを渡してください");
    return list("");
}

// V は c.set / c.get で使う変数の型。アプリと同じものを指定する: createRouter<"/admin", Vars>("/admin")
export function createRouter<Prefix extends string, V extends object = Record<string, unknown>>(
    prefix: Prefix,
): Router<Prefix, V> {
    // 子のルーターは、つなげた時点ではなく app.route の時点で中身を読む(あとから足したルートも入る)
    const items: ({ kind: "entry"; entry: GroupEntry } | { kind: "router"; router: Router })[] = [];
    const push = (name: string, path: string, handler: Handler) => {
        items.push({ kind: "entry", entry: { kind: "route", method: name, path, handler } });
    };
    const method = (name: string) =>
        ((path: string, a: Handler | RouteSchemas, b?: Handler) => push(name, path, routeHandler(path, a, b))) as GroupMethod<Prefix, V>;

    const router: Router<Prefix, V> = {
        prefix,
        use(pathOrMw, mw) {
            const path = typeof pathOrMw === "string" ? pathOrMw : "/";
            const fn = typeof pathOrMw === "string" ? mw : pathOrMw;
            if (!fn) throw new Error(`router.use("${path}", ...) にミドルウェアがありません`);
            items.push({ kind: "entry", entry: { kind: "use", path, mw: fn as Middleware } });
        },
        get: method("GET"),
        post: method("POST"),
        put: method("PUT"),
        patch: method("PATCH"),
        delete: method("DELETE"),
        all: method("ALL"),
        head: method("HEAD"),
        options: method("OPTIONS"),
        on: ((methods: string | readonly string[], path: string, a: Handler<any> | RouteSchemas, b?: Handler<any>) => {
            const list = typeof methods === "string" ? [methods] : methods;
            if (list.length === 0) throw new Error(`router.on(..., "${path}") にメソッドがありません`);
            const handler = routeHandler(path, a, b);
            for (const m of list) {
                if (m.toUpperCase() === "ALL") throw new Error("すべてのメソッドで動かすには all() を使ってください");
                // 名前の確認(CONNECT などの拒否)は、ここで先にしておく(app.route まで待たない)
                push(normalizeMethod(m), path, handler);
            }
        }) as Router<Prefix, V>["on"],
        route(child) {
            if (!entries.has(child)) throw new TypeError("route() には createRouter() で作ったルーターを渡してください");
            items.push({ kind: "router", router: child });
        },
    };

    const seen = new Set<Router>();
    entries.set(router, (base) => {
        // ルーターが自分自身を(間接的にでも)含んでいると終わらないので止める
        if (seen.has(router)) throw new Error(`ルーター ${prefix} が自分自身を含んでいます`);
        seen.add(router);
        try {
            const here = joinPath(base, prefix);
            return items.flatMap((item) =>
                item.kind === "router"
                    ? entries.get(item.router)!(here)
                    : [{ ...item.entry, path: joinPath(here, item.entry.path) }],
            );
        } finally {
            seen.delete(router);
        }
    });

    return router;
}
