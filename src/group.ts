// ルートのグループ化。プレフィックスは createRouter のときに決める
// (あとから app.route("/users/:id", router) のように付ける形だと、中のハンドラーで id の型が分からないため)
import type { Handler, Middleware } from "./context.ts";
import { splitPattern, type ExtractParams, type Simplify } from "./router.ts";

// プレフィックスとパスをつないだときのパラメーター。"/" を挟むので、"posts" のように "/" なしで書いてもよい
type GroupParams<Prefix extends string, Path extends string> = Simplify<ExtractParams<`${Prefix}/${Path}`>>;

type GroupMethod<Prefix extends string, V extends object> = <Path extends string>(
    path: Path,
    handler: Handler<GroupParams<Prefix, Path>, V>,
) => void;

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
    const method =
        (name: string) =>
        (path: string, handler: Handler<any, V>): void => {
            items.push({ kind: "entry", entry: { kind: "route", method: name, path, handler: handler as Handler } });
        };

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
