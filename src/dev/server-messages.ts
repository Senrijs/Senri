// サーバーだけが使う、開発モードの文言(ターミナルの警告と、テキストのレスポンス)。en を元にして、ja は同じキーを必ず持つ
import type { Lang } from "../lang.ts";
import { fill, type Params } from "./messages.ts";

const en = {
    "warn.envUnreadable": "devtools() is off: NODE_ENV is not readable. Run with --allow-env=NODE_ENV to enable it.",
    "warn.localOnly":
        "NODE_ENV is {env}, so dev output is shown only for requests to localhost (this request: {host}). Set NODE_ENV=development to show it for all requests, or NODE_ENV=production in production.",
    "warn.notSet": "not set",

    "warn.paramDot": '{where}: the parameter is named "{name}". Senri does not split a parameter at "."; check the value in the handler or with a schema.',
    "warn.literal": '{where}: "{segment}" is compared as literal text. Senri has no optional segments or patterns; use ":name" or "*".',
    "warn.unmatched": 'Middleware "{name}" at "{path}" matches no route. Ignore this if it answers by itself.',
    "warn.unmatchedClose": 'Middleware "{name}" at "{path}" matches no route. Did you mean "{close}"? Ignore this if it answers by itself.',

    "res.methodNotAllowed": "405 Method Not Allowed: {method} {path}\nAllowed: {allow}",
    "res.queryNoBody": "400 Bad Request: this QUERY request has no body\nQUERY is a method that sends the search conditions in the body",
    "res.queryNoType": "415 Unsupported Media Type: this QUERY request has no Content-Type\nSpecify the format of the body (for example, Content-Type: application/json)",
    "res.csrfRejected": "403 Forbidden: csrf() rejected a {method} request from another origin ({origin})\nIf you trust that origin, add it with csrf({ origin: [...] })",
    "res.didYouMean": "Did you mean: {method} {path} ?",
    "res.validation": "400 Bad Request: {target} failed schema validation",

    "target.params": "The path parameters",
    "target.query": "The query",
    "target.body": "The body",

    "schema.shape": "{path}: the second argument must be { params, query, body } schemas or a handler",
    "schema.key": '{path}: only params, query and body can be given as schemas ("{key}" cannot be used)',
    "schema.type": "{path}: {key} is not a Standard Schema schema (pass a schema from Zod, Valibot, ArkType or similar)",
    "route.reserved": "{method} {path}: paths under /_senri are reserved for the dashboard in development mode",
};

/** A key of the server's development messages. */
export type ServerMessageKey = keyof typeof en;

const ja: Record<ServerMessageKey, string> = {
    "warn.envUnreadable": "NODE_ENV を読めないので devtools() は無効です。--allow-env=NODE_ENV を付けると使えます",
    "warn.localOnly":
        "NODE_ENV が {env} なので、開発用の出力は localhost へのリクエストだけにしています(このリクエスト: {host})。すべてのリクエストで出すには NODE_ENV=development を、本番では NODE_ENV=production を指定してください",
    "warn.notSet": "未設定",

    "warn.paramDot": '{where}: パラメーターの名前が "{name}" になります。Senri は "." でパラメーターを分けません。ハンドラーかスキーマで確かめてください',
    "warn.literal": '{where}: "{segment}" は文字として比べます。Senri に省略できるセグメントやパターンはありません。":name" か "*" を使ってください',
    "warn.unmatched": '"{path}" のミドルウェア({name})は、どのルートにも当たりません。打ち間違いではありませんか？ルートなしで自分で返すミドルウェアなら、問題ありません',
    "warn.unmatchedClose": '"{path}" のミドルウェア({name})は、どのルートにも当たりません。"{close}" の打ち間違いではありませんか？ルートなしで自分で返すミドルウェアなら、問題ありません',

    "res.methodNotAllowed": "405 Method Not Allowed: {method} {path}\n{allow} ならあります",
    "res.queryNoBody": "400 Bad Request: QUERY リクエストにボディがありません\nQUERY は、検索の条件をボディに入れて送るメソッドです",
    "res.queryNoType": "415 Unsupported Media Type: QUERY リクエストに Content-Type がありません\nボディの形式を指定してください(例: Content-Type: application/json)",
    "res.csrfRejected": "403 Forbidden: よそのオリジン({origin})からの {method} リクエストを、csrf() が拒否しました\n信頼できるオリジンなら、csrf({ origin: [...] }) に足してください",
    "res.didYouMean": "もしかして: {method} {path} ?",
    "res.validation": "400 Bad Request: {target}が、スキーマに合いません",

    "target.params": "パスパラメーター",
    "target.query": "クエリ",
    "target.body": "ボディ",

    "schema.shape": "{path}: 2つ目の引数には { params, query, body } のスキーマかハンドラーを渡してください",
    "schema.key": '{path}: スキーマに渡せるのは params / query / body だけです("{key}" は使えません)',
    "schema.type": "{path}: {key} が Standard Schema のスキーマではありません(Zod・Valibot・ArkType などのスキーマを渡してください)",
    "route.reserved": "{method} {path}: /_senri 以下は、開発モードではダッシュボード用に予約されています",
};

export const SERVER_MESSAGES: Record<Lang, Record<ServerMessageKey, string>> = { en, ja };

export function serverMessage(lang: Lang, key: ServerMessageKey, params?: Params): string {
    return fill(SERVER_MESSAGES[lang][key], params);
}
