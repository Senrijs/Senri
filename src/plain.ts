// Node で Request / Response を作らずに答えるための、小さな部品
// 純正のミドルウェアが使うので、Context を読み込まない(cors や logger だけを使うバンドルに、Context が付いてこないように)

// Node のアダプターから来たリクエスト。create() は本物の Request(new Request で作ったもの)を返す
export type LazyRequest = {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    hasBody: boolean;
    create(): Request;
};

// ハンドラーの戻り値を、Response を作らずに書くための中身(Node のアダプターが書く)
// status と headers を持つので、純正のミドルウェアは Response と同じ書き方で扱える
// 利用者には見せない: かかるミドルウェアが全部 markPlainSafe() のものなときだけ、next() がこれを返す
export class PlainResponse {
    readonly status: number;
    readonly type: string;
    // prettyJSON() が差し替える
    body: string;
    // c.header() で設定したヘッダー
    readonly own: Headers | undefined;
    #headers: Headers | undefined;

    constructor(status: number, type: string, body: string, own: Headers | undefined) {
        this.status = status;
        this.type = type;
        this.body = body;
        this.own = own;
    }

    // 純正のミドルウェアが足すヘッダー。使われたときだけ作る
    get headers(): Headers {
        return (this.#headers ??= new Headers({ "content-type": this.type }));
    }

    get added(): Headers | undefined {
        return this.#headers;
    }
}

// next() の結果を、status と headers でしか使わない純正のミドルウェアの印
// 利用者が書いたミドルウェアには付けない(本物の Response を渡す)
const plainSafe = new WeakSet<object>();

export function markPlainSafe<T extends object>(middleware: T): T {
    plainSafe.add(middleware);
    return middleware;
}

export const isPlainSafe = (middleware: object): boolean => plainSafe.has(middleware);

// c.req をまだ読んでいない Node のリクエストなら、その中身。それ以外は null
// Context は読み込めないので、Node 用の Context がここに登録する
type HasRequest = { readonly req: Request };
let lazySourceOf: (c: HasRequest) => LazyRequest | null = () => null;

export function setLazySourceOf(read: typeof lazySourceOf): void {
    lazySourceOf = read;
}

// 純正のミドルウェアが、Request を作らずに読むためのもの
export const methodOf = (c: HasRequest): string => lazySourceOf(c)?.method ?? c.req.method;
export const urlOf = (c: HasRequest): string => lazySourceOf(c)?.url ?? c.req.url;

// 名前は小文字で渡す
export function headerOf(c: HasRequest, name: string): string | null {
    const source = lazySourceOf(c);
    if (!source) return c.req.headers.get(name);
    const value = source.headers[name];
    return value === undefined ? null : Array.isArray(value) ? value.join(", ") : value;
}

// 本文がないと分かっているか(分からなければ false。c.req.body を見る)
export const hasNoBody = (c: HasRequest): boolean => lazySourceOf(c)?.hasBody === false;
