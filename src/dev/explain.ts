// 本体が投げるエラー(短い英語 + code)に、開発モードで日本語の説明を付ける
// 本体を小さくするため、長い説明はこちらに置いている(src/errors.ts の senriError)
import { errorCode } from "../errors.ts";

const JA: Record<string, string> = {
    route_duplicate: "同じメソッド・同じ形のパスが、すでに登録されています(パラメーター名だけが違うものも同じとみなします)。あとから登録したほうは呼ばれません",
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
    no_valid: "c.valid() で読めるのは、ルートに { query } や { body } のスキーマを渡したものだけです",
    no_execution_ctx: "c.executionCtx は Cloudflare Workers で、app.fetch(req, env, ctx) として呼ばれたときだけ使えます",
    returned_function: "ハンドラーが関数を返しました。呼び出し忘れではありませんか？",
    returned_nothing: "ハンドラーが何も返していません(undefined / null)",
    next_twice: "next() が2回呼ばれました。1つのミドルウェアで呼べるのは1回だけです",
    no_response: "ミドルウェアが何も返さず、next() も呼んでいません",
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
