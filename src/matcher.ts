// ルートを探すための木(Trie)。全部のルートを順に試す代わりに、セグメントを1つずつたどる
//
// 優先順位は、以前の「ルートを compareRoutes で並べて、前から順に試す」と同じになるようにしている:
// - セグメントの数が違うルートには、そもそもマッチしない(木の深さ = セグメントの数)。ワイルドカードだけは、残り全部に合う
// - 前から見て最初に違うところで、静的なセグメントのほうが優先("/users/me" は "/users/:id" より先)
//   → 各ノードで「静的な子」→「パラメーターの子」→「ワイルドカード」の順にたどる(深さ優先)
// - 静的な子の先で見つからなければ、戻ってパラメーターの子を試す(バックトラック)
//   例: "/users/me/posts" は、"/users/me/likes" の枝で見つからなければ "/users/:id/posts" に行く
// パラメーターもワイルドカードもないルートは、パスの文字列をキーにした Map で1回で引ける
import type { Route } from "./router.ts";

// 同じ形のパス(パラメーター名の違いだけのものも含む)のルート。メソッドごとに1つずつ
export type Leaf = Route[];

type Node = {
    // 静的なセグメントの子("users" → Node)
    statics: Map<string, Node> | null;
    // パラメーター(":id")の子。名前はルートごとに違ってよいので、ここでは区別しない
    param: Node | null;
    // ここで終わるルート
    leaf: Leaf | null;
    // ここから先の全部に合うルート("/files/*" なら "files" のノードに置く)
    wild: Leaf | null;
};

// パスにマッチしたルートの組と、パラメーターの値(パスに出てきた順)
export type Match = { leaf: Leaf; values: string[] };

const node = (): Node => ({ statics: null, param: null, leaf: null, wild: null });

const NO_VALUES: string[] = [];

export type Matcher = {
    add(route: Route): void;
    // パラメーターもワイルドカードもないルートで、パス("/users/me")にぴったり合うもの
    // 静的なルートは優先順位がいちばん高いので、ここにメソッドが合うものがあれば、ほかを探さなくてよい
    staticLeaf(path: string): Leaf | undefined;
    // 優先順位の順に、マッチしたものを全部返す(メソッドはまだ見ない)
    // 405 と自動の OPTIONS を決めるためのものなので、ワイルドカードのルートは含めない(パスが合っても、メソッドが違えば 404)
    match(segments: readonly string[]): Match[];
    // 優先順位の順で、メソッドが合う最初のルート。ワイルドカードのルートも含む
    // (ほとんどのリクエストはこれで決まるので、途中の配列を作らずに探す)
    first(segments: readonly string[], method: string): { route: Route; values: string[] } | null;
};

export function createMatcher(): Matcher {
    const root = node();
    // パラメーターのないルートだけ。キーは "/users/me" の形(c.path と同じ)
    const statics = new Map<string, Leaf>();

    const leafOf = (route: Route): Leaf => {
        let n = root;
        for (const segment of route.segments) {
            if (segment === "*") return (n.wild ??= []);
            if (segment.startsWith(":")) {
                n = n.param ??= node();
            } else {
                n.statics ??= new Map();
                let child = n.statics.get(segment);
                if (!child) n.statics.set(segment, (child = node()));
                n = child;
            }
        }
        return (n.leaf ??= []);
    };

    const walk = (n: Node, segments: readonly string[], i: number, values: string[], out: Match[]) => {
        if (i === segments.length) {
            if (n.leaf) out.push({ leaf: n.leaf, values: values.length > 0 ? values.slice() : NO_VALUES });
            return;
        }
        const segment = segments[i]!;
        const next = n.statics?.get(segment);
        if (next) walk(next, segments, i + 1, values, out);
        if (n.param) {
            values.push(segment);
            walk(n.param, segments, i + 1, values, out);
            values.pop();
        }
    };

    // walk と同じ順番でたどり、メソッドが合うルートを見つけたらそこで止める。静的な子とパラメーターの子のあとに、ワイルドカードも見る
    const seek = (
        n: Node,
        segments: readonly string[],
        i: number,
        method: string,
        values: string[],
    ): Route | null => {
        if (i === segments.length) {
            if (n.leaf) {
                for (const route of n.leaf) if (route.method === method) return route;
            }
        } else {
            const segment = segments[i]!;
            const next = n.statics?.get(segment);
            if (next) {
                const found = seek(next, segments, i + 1, method, values);
                if (found) return found;
            }
            if (n.param) {
                values.push(segment);
                const found = seek(n.param, segments, i + 1, method, values);
                if (found) return found;
                values.pop();
            }
        }
        if (n.wild) {
            for (const route of n.wild) {
                if (route.method === method) {
                    // 値はデコード済みのセグメントをつないだもの(%2F は splitPath が 400 にするので、値の "/" は区切りだけ)
                    values.push(segments.slice(i).join("/"));
                    return route;
                }
            }
        }
        return null;
    };

    return {
        add(route) {
            const leaf = leafOf(route);
            leaf.push(route);
            if (!route.segments.some((s) => s.startsWith(":") || s === "*")) statics.set("/" + route.segments.join("/"), leaf);
        },

        staticLeaf(path) {
            return statics.get(path);
        },

        match(segments) {
            const out: Match[] = [];
            walk(root, segments, 0, [], out);
            return out;
        },

        first(segments, method) {
            const values: string[] = [];
            const route = seek(root, segments, 0, method, values);
            return route ? { route, values } : null;
        },
    };
}
