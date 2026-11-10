// 本体が投げるエラー(短い英語 + code)に、開発モードで詳しい説明を付ける
// 本体を小さくするため、長い説明はこちらに置いている(src/errors.ts の senriError)
import { errorCode } from "../errors.ts";
import type { Lang } from "../lang.ts";

const EN = {
    route_duplicate: "This method and path shape is already registered (paths that differ only in parameter names count as the same). The later one is never called",
    wildcard_position: '* can only be a whole last segment of a path ("/files/*"). A * in the middle, or as part of a segment such as "*.js", cannot be used',
    param_name: "The parameter name has a character that cannot be used. Senri has no optional parameters (:id?) or regular expressions (:id{[0-9]+}). Check the value in the handler or with a schema",
    param_empty: 'The parameter name is empty (write a name after ":")',
    param_twice: "The same parameter name is used twice in one path",
    method_invalid: "The method name has a character that cannot be used",
    method_unsupported: "CONNECT, TRACE and TRACK are not supported (they cannot be registered)",
    no_handler: "There is no handler. Pass one after the schemas, as in app.get(path, { params, query, body }, handler)",
    no_middleware: "There is no middleware",
    no_method: "There is no method",
    on_all: "Use app.all() to run on every method",
    route_key: 'The route is not written correctly. Put a space between the method and the path, as in "GET /hello"',
    route_value: "A route in the table must be a handler, or a route with schemas made with endpoint(schemas, handler)",
    route_prefix: 'The prefix of defineRoutes() must start with "/" and must not end with "/", as in "/users"',
    route_merge: "mergeRoutes() got the same route key in two tables. One of them would never be used",
    not_app: "app.route(prefix, app) takes an app made with createApp()",
    not_router: "Pass a router made with createRouter()",
    router_cycle: "The router contains itself",
    csrf_origin: 'Write each origin of csrf({ origin }) like "https://example.com", with no path or trailing slash',
    jwt_algorithms: 'Give the algorithms to accept, such as algorithms: ["HS256"]. Senri never trusts the alg of the token by itself, and does not support "none"',
    jwt_key: "This key cannot be used for the algorithm. HS256 needs a secret of 32 bytes or more (HS384: 48, HS512: 64). Other algorithms take a PEM (PUBLIC KEY / PRIVATE KEY), a JWK or a CryptoKey",
    jwt_payload: "The JWT payload must be an object, and expiresIn a number of seconds",
    jwt_realm: "The realm can only contain printable ASCII characters",
    cookie_name: "The cookie name has a character that cannot be used",
    cookie_host_domain: "A cookie starting with __Host- cannot have a domain (browsers discard it). Remove the domain",
    cookie_host_path: 'The path of a cookie starting with __Host- must be "/" (browsers discard it otherwise). Remove the path or make it "/"',
    cookie_secret: "Pass the secret for signed cookies as a non-empty string (or a list of them). Read it from an environment variable or c.env instead of writing it in the code",
    no_valid: "c.valid() can only read what the route has a schema for, such as { query } or { body }",
    no_execution_ctx: "c.executionCtx is only available on Cloudflare Workers, when called as app.fetch(req, env, ctx)",
    redirect_status: "The status of c.redirect() can only be 301, 302, 303, 307 or 308",
    redirect_location: "This value cannot be a redirect target. It cannot contain line breaks (to prevent header injection) or characters that cannot be in a URL. Is a value from outside being passed as is?",
    returned_function: "The handler returned a function. Did you forget to call it?",
    returned_nothing: "The handler returned nothing (undefined or null)",
    next_twice: "next() was called twice. One middleware can call it only once",
    no_response: "The middleware returned nothing and did not call next()",
    upload_limit_options: "The options of uploadLimit() are not valid. maxTotalSize is required (c.body() reads everything into memory, so this is the limit on the memory used). extensions must start with .",
    sse_message: "The value given to writeSSE() is not valid. event and id cannot contain line breaks (they could inject other fields). retry is an integer of 0 or more, and data is a string",
    sse_heartbeat: "The heartbeat of streamSSE() must be a number of milliseconds greater than 0, or false to turn it off",
    multipart_limits: "The limits of multipart() must be numbers of 0 or more (maxParts, maxFileSize, maxFieldSize, maxHeaderSize, maxTotalSize)",
    multipart_body_used: "multipart() was called after the request body had already been read. c.body(), uploadLimit() and a body schema on the route read the whole body first. Use only multipart() on this route, and call it once",
    multipart_part_skipped: "A part was read after the loop had moved on to the next part (or had ended). Read each part, for example by awaiting the save of part.stream, before the loop continues",
    pretty_json_options: "The space of prettyJSON() must be an integer from 1 to 10, and query a non-empty string",
    language_detector_options: "The options of languageDetector() are not valid. supportedLanguages cannot be empty, and fallbackLanguage must be one of them. order can contain querystring, cookie and header",
    cache_options: "The cacheControl of cache() must be a string with characters allowed in a header. vary is an array of header names",
    trailing_slash_options: 'The mode of trailingSlash() must be "remove" or "add", and status 301 or 308',
    method_override_options: "The options of methodOverride() are not valid. form and header cannot both be false. allow cannot contain GET, HEAD, CONNECT or TRACE",
    ip_restriction_options: "ipRestriction() needs at least one of allow and deny",
    ip_restriction_range: "allow and deny of ipRestriction() must be arrays of IP addresses or CIDRs (such as 10.0.0.0/8)",
    rate_limit_options: "The windowMs of rateLimit() must be a number greater than 0, and limit and maxKeys integers of 1 or more. store needs increment()",
    trust_proxy_options: "trustProxy() takes exactly one of hops (an integer of 1 or more) and proxies (an array of IP addresses or CIDRs). header can only have characters allowed in a header name",
    request_id_header: "The headerName of requestId() has a character that cannot be used in a header name",
    timeout_ms: "The time of timeout() must be a number of milliseconds greater than 0",
    timeout_status: "The status of timeout() must be from 400 to 599",
    auth_options: "The options of basicAuth() or bearerAuth() are not valid. Empty values cannot be used (did reading an environment variable fail?). A user name cannot contain :. A token can only contain A-Z a-z 0-9 - . _ ~ + / and a trailing =",
    auth_realm: "realm can only contain printable ASCII characters",
    compress_encoding: "The encoding of compress() can only be gzip or deflate",
    compress_threshold: "The threshold of compress() must be a number of 0 or more",
};

const JA: Record<keyof typeof EN, string> = {
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
    route_value: "表のルートは、ハンドラーか、endpoint(schemas, handler) で作ったスキーマ付きのルートにしてください",
    route_prefix: "defineRoutes() の前置きは、\"/users\" のように \"/\" で始め、\"/\" で終わらないようにしてください",
    route_merge: "mergeRoutes() に、同じルートのキーが 2 つの表から渡されました。どちらかは使われません",
    not_app: "app.route(prefix, app) には createApp() で作ったアプリを渡してください",
    not_router: "createRouter() で作ったルーターを渡してください",
    router_cycle: "ルーターが自分自身を含んでいます",
    csrf_origin: 'csrf({ origin }) のオリジンは "https://example.com" の形で書いてください(パスや末尾の / は付けない)',
    jwt_algorithms: '受け付けるアルゴリズムを algorithms: ["HS256"] のように指定してください。Senri はトークンの alg だけを信じることはせず、"none" にも対応しません',
    jwt_key: "この鍵は、このアルゴリズムには使えません。HS256 の秘密鍵は 32 バイト以上(HS384 は 48、HS512 は 64)にしてください。ほかのアルゴリズムには、PEM(PUBLIC KEY / PRIVATE KEY)、JWK、CryptoKey を渡します",
    jwt_payload: "JWT のペイロードはオブジェクトに、expiresIn は秒数にしてください",
    jwt_realm: "realm に使えるのは、ASCII の印字できる文字だけです",
    cookie_name: "Cookie の名前に使えない文字があります",
    cookie_host_domain: "__Host- で始まる Cookie には domain を付けられません(ブラウザに捨てられます)。domain を外してください",
    cookie_host_path: "__Host- で始まる Cookie の path は \"/\" でなければなりません(ブラウザに捨てられます)。path を外すか \"/\" にしてください",
    cookie_secret: "署名付き Cookie の秘密鍵には、空でない文字列(またはその配列)を渡してください。コードに書かず、環境変数や c.env から読んでください",
    no_valid: "c.valid() で読めるのは、ルートに { query } や { body } のスキーマを渡したものだけです",
    no_execution_ctx: "c.executionCtx は Cloudflare Workers で、app.fetch(req, env, ctx) として呼ばれたときだけ使えます",
    redirect_status: "c.redirect() の status に使えるのは 301 / 302 / 303 / 307 / 308 だけです",
    redirect_location: "リダイレクト先に使えない値です。改行(ヘッダー注入の対策)や、URL にできない文字は入れられません。外から受け取った値をそのまま渡していませんか？",
    returned_function: "ハンドラーが関数を返しました。呼び出し忘れではありませんか？",
    returned_nothing: "ハンドラーが何も返していません(undefined / null)",
    next_twice: "next() が2回呼ばれました。1つのミドルウェアで呼べるのは1回だけです",
    no_response: "ミドルウェアが何も返さず、next() も呼んでいません",
    upload_limit_options: "uploadLimit() の設定が正しくありません。maxTotalSize は必須です(c.body() が全部メモリに読むので、これが使うメモリの上限になります)。extensions は . で始めてください",
    sse_message: "writeSSE() の値が正しくありません。event と id に改行は使えません(別のフィールドを注入できてしまうため)。retry は 0 以上の整数、data は文字列です",
    sse_heartbeat: "streamSSE() の heartbeat は、0 より大きいミリ秒の数か、止めるときの false で指定してください",
    multipart_limits: "multipart() の上限(maxParts / maxFileSize / maxFieldSize / maxHeaderSize / maxTotalSize)は、0 以上の数で指定してください",
    multipart_body_used: "リクエストの本文をすでに読んだあとで multipart() を呼びました。c.body()、uploadLimit()、ルートの body のスキーマは、先に本文を全部読みます。このルートでは multipart() だけを使い、呼ぶのは1回にしてください",
    multipart_part_skipped: "ループが次のパーツへ進んだあと(または終わったあと)で、前のパーツを読もうとしました。part.stream の保存を await するなどして、ループが進む前に読み終えてください",
    pretty_json_options: "prettyJSON() の space は 1〜10 の整数、query は空でない文字列で指定してください",
    language_detector_options: "languageDetector() の設定が正しくありません。supportedLanguages は空にできず、fallbackLanguage はその中のどれかです。order に使えるのは querystring / cookie / header です",
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

export const EXPLANATIONS: Record<Lang, Record<string, string>> = { en: EN, ja: JA };

// すでに説明を付けたエラー(同じエラーを別の言語で2回説明しないように)
const explained = new WeakSet<Error>();

// 説明(なければ null)
export function explainText(err: unknown, lang: Lang): string | null {
    const code = errorCode(err);
    return code ? (EXPLANATIONS[lang][code] ?? null) : null;
}

// エラーの message の前に、説明を付ける(code や種類はそのまま)
export function explain(err: unknown, lang: Lang): unknown {
    const text = explainText(err, lang);
    if (text && err instanceof Error && !explained.has(err)) {
        explained.add(err);
        err.message = `${text}\n${err.message}`;
    }
    return err;
}
