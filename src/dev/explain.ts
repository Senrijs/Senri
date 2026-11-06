// 本体が投げるエラー(短い英語 + code)に、開発モードで日本語の説明を付ける
// 本体を小さくするため、長い説明はこちらに置いている(src/errors.ts の senriError)
import { errorCode } from "../errors.ts";

const JA: Record<string, string> = {
    route_duplicate: "同じメソッド・同じ形のパスが、すでに登録されています(パラメーター名だけが違うものも同じとみなします)。あとから登録したほうは呼ばれません",
    wildcard_position: "* は、パスの最後のセグメント全体にだけ書けます(\"/files/*\")。途中の * や、\"*.js\" のような一部の * は使えません",
    param_name: "パラメーター名に使えない文字があります。Senri に省略できるパラメーター(:id?)や正規表現(:id{[0-9]+})はありません。ハンドラーかスキーマで確かめてください",
    param_empty: "パラメーター名が空です(\":\" のあとに名前を書いてください)",
    param_twice: "1つのパスで、同じパラメーター名が2回使われています",
    method_invalid: "メソッド名に使えない文字があります",
    method_unsupported: "CONNECT / TRACE / TRACK は扱いません(登録できません)",
    no_handler: "ハンドラーがありません。app.get(path, { params, query, body }, handler) のように、スキーマのあとにハンドラーを渡してください",
    no_middleware: "ミドルウェアがありません",
    no_method: "メソッドがありません",
    on_all: "すべてのメソッドで動かすには app.all() を使ってください",
    route_key: "ルートの書き方が違います。\"GET /hello\" のように、メソッドとパスの間にスペースを入れてください",
    not_app: "app.route(prefix, app) には createApp() で作ったアプリを渡してください",
    not_router: "createRouter() で作ったルーターを渡してください",
    router_cycle: "ルーターが自分自身を含んでいます",
    cookie_name: "Cookie の名前に使えない文字があります",
    cookie_host_domain: "__Host- で始まる Cookie には domain を付けられません(ブラウザに捨てられます)。domain を外してください",
    cookie_host_path: "__Host- で始まる Cookie の path は \"/\" でなければなりません(ブラウザに捨てられます)。path を外すか \"/\" にしてください",
    no_valid: "c.valid() で読めるのは、ルートに { query } や { body } のスキーマを渡したものだけです",
    no_execution_ctx: "c.executionCtx は Cloudflare Workers で、app.fetch(req, env, ctx) として呼ばれたときだけ使えます",
    redirect_status: "c.redirect() の status に使えるのは 301 / 302 / 303 / 307 / 308 だけです",
    redirect_location: "リダイレクト先に使えない値です。改行(ヘッダー注入の対策)や、URL にできない文字は入れられません。外から受け取った値をそのまま渡していませんか？",
    returned_function: "ハンドラーが関数を返しました。呼び出し忘れではありませんか？",
    returned_nothing: "ハンドラーが何も返していません(undefined / null)",
    next_twice: "next() が2回呼ばれました。1つのミドルウェアで呼べるのは1回だけです",
    no_response: "ミドルウェアが何も返さず、next() も呼んでいません",
    cache_options: "cache() の cacheControl には、ヘッダーに使える文字の文字列を指定してください。vary はヘッダー名の配列です",
    trailing_slash_options: "trailingSlash() の mode は \"remove\" か \"add\"、status は 301 か 308 で指定してください",
    method_override_options: "methodOverride() の設定が正しくありません。form と header の両方を false にはできません。allow に GET / HEAD / CONNECT / TRACE は指定できません",
    ip_restriction_options: "ipRestriction() には allow か deny の、少なくとも一方を指定してください",
    ip_restriction_range: "ipRestriction() の allow と deny には、IP アドレスか CIDR(10.0.0.0/8 など)の配列を指定してください",
    rate_limit_options: "rateLimit() の windowMs は 0 より大きい数、limit と maxKeys は 1 以上の整数で指定してください。store には increment() が必要です",
    trust_proxy_options: "trustProxy() には hops(1 以上の整数)か proxies(IP アドレスや CIDR の配列)の、どちらか一方を指定してください。header はヘッダー名に使える文字だけです",
    request_id_header: "requestId() の headerName に、ヘッダー名に使えない文字があります",
    timeout_ms: "timeout() の時間は、0 より大きいミリ秒の数で指定してください",
    timeout_status: "timeout() の status には 400〜599 のステータスを指定してください",
    auth_options: "basicAuth() / bearerAuth() の設定が正しくありません。空の値は使えません(環境変数の読み忘れではありませんか？)。ユーザー名に : は使えません。トークンに使えるのは A-Z a-z 0-9 - . _ ~ + / と末尾の = だけです",
    auth_realm: "realm に使えるのは、ASCII の印字できる文字だけです",
    compress_encoding: "compress() の encoding に使えるのは gzip と deflate だけです",
    compress_threshold: "compress() の threshold は 0 以上の数で指定してください",
};

// 日本語の説明(なければ null)
export function explainText(err: unknown): string | null {
    const code = errorCode(err);
    return code ? (JA[code] ?? null) : null;
}

// エラーの message の前に、日本語の説明を付ける(code や種類はそのまま)
export function explain(err: unknown): unknown {
    const ja = explainText(err);
    if (ja && err instanceof Error && !err.message.startsWith(ja)) err.message = `${ja}\n${err.message}`;
    return err;
}
