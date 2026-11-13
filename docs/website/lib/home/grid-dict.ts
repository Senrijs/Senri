// グリッド版のトップページ(components/top)の文言。docs/design/GridFull.dc.html の日本語をもとに、英語を足したもの
// ナビ・テーマ・言語のボタンなど、前のトップページと同じものは lib/home/dict.ts を使う
import type { Lang } from "@/lib/i18n";

type Scene = [title: string, body: string];
type Feature = { title: string; desc: string; points: string[]; href: string };
type Slide = { title: string; desc: string };
type Release = { title: string; desc: string };

const ja = {
    // ナビ
    navStart: "はじめる",
    // ヒーロー。badgeVersion で始まるバージョンのときだけ、badge の説明を付ける(リリースのたびに見直す)
    badgeVersion: "0.3",
    badge: "型付きのレスポンスと本文の上限",
    h1: ["どこでも動く、", "Web フレームワーク"],
    lead: "Request を受けて、Response を返す。それだけで、Bun・Node.js・Deno・Cloudflare Workers・ブラウザで同じコードが動きます。",
    perWeek: "/ 週 npm",
    // 数字の帯
    nRuntimes: "ランタイム",
    nSize: "gzip 後の大きさ",
    nDeps: "依存",
    nTests: "テスト",
    // JOURNEY
    jLead: "GET /users/42 が、来て、戻るまで。",
    jAria: "リクエストの旅",
    jNodes: [
        ["Router", "ルートを探す"],
        ["requestId", "ID を付ける"],
        ["cors", "よそから来たか"],
        ["auth", "誰か確かめる"],
        ["handler", "答えを返す"],
    ] as Scene[],
    jScenes: [
        ["リクエストが届く", "GET /users/42。Web 標準の Request が、そのまま Senri に渡されます。"],
        ["ルートを探す", "枝分かれしたルートから、/users/:id にまっすぐたどり着きます。id は型付きで受け取れます。"],
        ["ミドルウェアをくぐる", "requestId、cors、auth。玉ねぎの皮を 1 枚ずつくぐるように、順番に通っていきます。"],
        ["ハンドラーが答える", "返したいものを返すだけです。オブジェクトは、そのまま JSON になります。"],
        ["レスポンスが戻る", "Response が来た道を戻っていきます。どこで何ミリ秒かかったかは、ダッシュボードで見られます。"],
    ] as Scene[],
    jDash: "/_senri で、いつでも見られます",
    jWait: "待っています…",
    // TRY IT
    tryLead: "その場で、試してみる。",
    tryLive: "ブラウザの中で、本物の Senri が動いています。",
    tryRecorded: "最初のコードのままなら、ビルドのときに本物の Senri で動かした結果を出します。",
    tryHelp: "コードは書き換えられます。書き換えて送ると、ブラウザの中で本物の Senri を読み込んで動かします(約 130 KB)。",
    tryBoom: "わざとエラーを出す",
    // RUNTIMES
    rtLead: "どのランタイムでも、同じコードで。",
    rtAria: "ランタイムごとの起動",
    rtSame: "app.ts は、このまま。",
    rtKeep: "変わらない",
    rtChange: "ここだけ変わる",
    rtCaps: [
        "serve(app) と書くだけで、Bun で起動します。",
        "同じ serve(app) で、Node.js でも動きます。",
        "同じ serve(app) が、deno run でそのまま動きます。",
        "export default app と書けば、Cloudflare Workers に載ります。",
        "Service Worker の中でも、同じ app が答えます。",
    ],
    rtShow: (name: string) => `${name} の起動を見る`,
    // CLI
    cliH: ["起動して、", "すぐ見える。"],
    cliP: "ルートの一覧と、届いたリクエストが流れます。打ち間違いには「もしかして」。",
    cliAria: "npm create senri で作ったアプリを bun run dev で起動すると、ルートの一覧とリクエストのログが流れるターミナル",
    cliBoot: "起動しています…",
    // LAYERS
    layH: ["画面から、", "ランタイムまで。"],
    layAria: "レイヤーの組み立て",
    layScenes: [
        ["土台はランタイム", "Bun、Node.js、Deno、Workers、ブラウザ。どれも Web 標準の Request と Response を話します。"],
        ["その上に Senri", "Senri は Request を受け取り、Response を返すだけの層です。ランタイムの違いは、ここで吸収します。"],
        ["ミドルウェアをつなぐ", "requestId、cors、auth を順番に通って、最後にハンドラーが答えます。"],
        ["いずれ Ippo", "その上に、React や Vue で書けるメタフレームワーク Ippo が載る予定です。"],
    ] as Scene[],
    layIppo: "Ippo — React・Vue のメタフレームワーク",
    layDev: "開発中",
    // ROUTING
    trH: ["枝分かれしても、", "まっすぐ届く。"],
    trAria: "ルートを探す",
    trScenes: [
        ["リクエストが来る", "GET /users/42 が届きました。ここから、どのルートかを探します。"],
        ["根元から", "ルートは木の形で持っています。端から全部比べることはしません。"],
        ["/users へ", "1 つ目の区切り users で、枝を 1 本に絞ります。"],
        ["/users/:id に届く", "残りの 42 は :id に当てはまります。GET なので、このルートです。"],
        ["id は型付きで", 'ハンドラーには { id: "42" } が渡ります。id には TypeScript の型も付いています。'],
    ] as Scene[],
    // FEATURES
    featLead: "必要なものだけ。",
    zoom: "＋ 大きく見る",
    readDocs: "ドキュメントを読む →",
    close: "閉じる",
    features: [
        {
            title: "どこでも同じコード",
            desc: "書き換えるのは、起動するところだけです。",
            points: [
                "Bun・Node.js・Deno では serve(app)、Workers では export default app。",
                "アプリ本体のコードは、どのランタイムでも同じです。",
                "ブラウザの Service Worker でも、app.fetch がそのまま動きます。",
            ],
            href: "/docs/runtimes/bun",
        },
        {
            title: "教えてくれるエラー",
            desc: "原因の行と直し方を、日本語と英語で表示します。",
            points: [
                "開発モードでは、例外を投げた行とその前後のコードを表示します。",
                "よくある原因と直し方のヒントを、日本語と英語で出します。",
                "本番では 500 だけを返し、中身は見せません。",
            ],
            href: "/docs/dev/error-pages",
        },
        {
            title: "玉ねぎタイムライン",
            desc: "どのミドルウェアで時間がかかったかが、/_senri で分かります。",
            points: [
                "/_senri を開くと、届いたリクエストが一覧になります。",
                "1 つ選ぶと、ミドルウェアとハンドラーを通った順と時間が、入れ子の帯で分かります。",
                "Server-Timing ヘッダーにも出るので、ブラウザの開発者ツールでも見られます。",
            ],
            href: "/docs/dev/timeline",
        },
        {
            title: "型付きのクライアント",
            desc: "ルートの表から、呼び出し側に型と補完が付きます。",
            points: [
                "defineRoutes() の表の型を、そのままクライアントに渡します。",
                "パス・パラメーター・ボディ・レスポンスの型と補完が付きます。",
                "Proxy を使わない、関数 1 つの小さなクライアントです。",
            ],
            href: "/docs/typed-api/client",
        },
        {
            title: "OpenAPI",
            desc: "同じ表から、API の説明を作ります。",
            points: [
                "同じ表から OpenAPI 3.1 の文書を作ります。",
                "Zod・ArkType などのスキーマは、Standard JSON Schema で変換します。",
                "Scalar や Swagger UI に読ませれば、試せるドキュメントになります。",
            ],
            href: "/docs/typed-api/openapi",
        },
        {
            title: "本番まで",
            desc: "OpenTelemetry・Prometheus・WebSocket に対応しています。",
            points: [
                "otel() で、リクエストごとに span を作ります。middlewareSpans: true で、玉ねぎがそのままトレースになります。",
                "metrics() と metricsHandler() で、Prometheus の形式で出します。",
                "WebSocket は、Bun・Deno・Node.js(ws)・Workers で同じ書き方です。",
            ],
            href: "/docs/production/otel",
        },
    ] as Feature[],
    oaOps: ["ユーザーを 1 人取る", "ユーザーを作る", "ユーザーを消す"],
    // PATTERNS
    patAria: "よくある使い方",
    prev: "前へ",
    next: "次へ",
    slideOf: (n: number, total: number) => `${total} 枚中 ${n} 枚目`,
    slides: [
        { title: "返すだけで JSON", desc: "オブジェクトを返せば、そのまま JSON のレスポンスになります。" },
        { title: "1 行で守る", desc: "CORS もセキュリティのヘッダーも、use するだけです。" },
        { title: "流し続ける", desc: "Server-Sent Events も、切れないための heartbeat も最初から入っています。" },
        { title: "大きいファイルも少しずつ", desc: "メモリに全部載せずに、パーツを 1 つずつ読みます。" },
    ] as Slide[],
    // TIMELINE
    tlLead: "一歩ずつ、ここまで。",
    tlAll: "すべてのリリース →",
    tlPlanned: "予定",
    releases: {
        ippo: { title: "Ippo", desc: "Senri の上で動く、React や Vue のメタフレームワーク。" },
        "0.3.1": { title: "JSR 向けの型を直す", desc: "WebSocket の型を JSR に合わせ、create-senri の雛形を 0.3 に合わせました。" },
        "0.3.0": { title: "本文の上限と、型の整理", desc: "本文は既定で 1 MiB まで。クライアントは、ステータスごとにレスポンスの型が付きます。" },
        "0.2.23": { title: "OpenTelemetry と Prometheus", desc: "トレースとメトリクスを出せるようになりました。" },
        "0.2.22": { title: "型付きクライアントと OpenAPI", desc: "JWT・CSRF・WebSocket など、本番で要るものがそろいました。" },
        site: { title: "senri.skyia.jp を公開", desc: "ドキュメントは日本語と英語で読めます。" },
        "0.2.18": { title: "マルチパート", desc: "大きいファイルを少しずつ読めます。" },
        "0.2.0": { title: "ブラウザへ", desc: "Service Worker でも動くようになりました。" },
        "0.1.0": { title: "最初の公開", desc: "npm と JSR に出しました。" },
    } as Record<string, Release>,
    // はじめよう
    ctaH: "はじめよう。",
    proverb: "千里の道も、一歩から。",
    // フッター
    footBrand: "Web 標準で作った TypeScript のフレームワーク。",
    // OG 画像
    ogTopDesc: "Bun・Node.js・Deno・Workers・ブラウザで同じコードが動きます。",
    ogDocs: "ドキュメント",
    ogBlog: "ブログ",
    ogBlogDesc: "リリースのお知らせなど",
};

export type GridDict = typeof ja;

const en: GridDict = {
    navStart: "Get started",
    badgeVersion: "0.3",
    badge: "typed responses and body limits",
    h1: ["Runs anywhere.", "A web framework."],
    lead: "Take a Request, return a Response. That is all it takes for the same code to run on Bun, Node.js, Deno, Cloudflare Workers and browsers.",
    perWeek: "/ week npm",
    nRuntimes: "Runtimes",
    nSize: "Gzipped size",
    nDeps: "Dependencies",
    nTests: "Tests",
    jLead: "GET /users/42, there and back.",
    jAria: "The journey of a request",
    jNodes: [
        ["Router", "Find the route"],
        ["requestId", "Tag it with an ID"],
        ["cors", "Check the origin"],
        ["auth", "Check who it is"],
        ["handler", "Answer"],
    ],
    jScenes: [
        ["A request arrives", "GET /users/42. A web-standard Request goes straight into Senri."],
        ["Finding the route", "Through a branching tree of routes, straight to /users/:id. The id comes typed."],
        ["Through the middleware", "requestId, cors, auth. Layer by layer, like peeling an onion."],
        ["The handler answers", "Return what you want to return. An object becomes JSON."],
        ["The response goes back", "The Response travels back the way it came. The dashboard shows where every millisecond went."],
    ],
    jDash: "Always visible at /_senri",
    jWait: "Waiting…",
    tryLead: "Try it right here.",
    tryLive: "The real Senri is running in your browser.",
    tryRecorded: "With the original code, you see what the real Senri returned at build time.",
    tryHelp: "You can edit the code. When you send an edited version, the real Senri loads and runs in your browser (about 130 KB).",
    tryBoom: "Throw an error on purpose",
    rtLead: "The same code on every runtime.",
    rtAria: "Starting on each runtime",
    rtSame: "app.ts stays the same.",
    rtKeep: "Stays the same",
    rtChange: "Only this changes",
    rtCaps: [
        "Write serve(app) and it starts on Bun.",
        "The same serve(app) runs on Node.js.",
        "The same serve(app) runs as is with deno run.",
        "Write export default app and it runs on Cloudflare Workers.",
        "Inside a Service Worker, the same app answers.",
    ],
    rtShow: (name: string) => `Show how it starts on ${name}`,
    cliH: ["Start it.", "See it."],
    cliP: "Your routes, then every request as it arrives. Mistype a path and it asks: did you mean?",
    cliAria: "A terminal where an app made with npm create senri starts with bun run dev, lists its routes and logs requests",
    cliBoot: "Starting…",
    layH: ["From the screen", "to the runtime."],
    layAria: "Building up the layers",
    layScenes: [
        ["The runtime at the base", "Bun, Node.js, Deno, Workers and browsers all speak the web-standard Request and Response."],
        ["Senri on top", "Senri is a layer that takes a Request and returns a Response. It absorbs the differences between runtimes."],
        ["Middleware in a row", "Through requestId, cors and auth in order, and finally the handler answers."],
        ["Ippo, someday", "On top of that, Ippo, a meta-framework for React and Vue, is planned."],
    ],
    layIppo: "Ippo — a meta-framework for React and Vue",
    layDev: "In development",
    trH: ["Many branches,", "one straight path."],
    trAria: "Finding the route",
    trScenes: [
        ["A request comes in", "GET /users/42 has arrived. Now to find which route it is."],
        ["From the root", "Routes are kept as a tree. They are not compared one by one."],
        ["Into /users", "The first segment, users, narrows it to one branch."],
        ["Reaching /users/:id", "The rest, 42, fits :id. It is a GET, so this is the route."],
        ["A typed id", 'The handler gets { id: "42" }, and id has a TypeScript type.'],
    ],
    featLead: "Only what you need.",
    zoom: "＋ Enlarge",
    readDocs: "Read the docs →",
    close: "Close",
    features: [
        {
            title: "Same code everywhere",
            desc: "Only the startup line changes.",
            points: [
                "serve(app) on Bun, Node.js and Deno; export default app on Workers.",
                "The app itself is the same on every runtime.",
                "In a browser's Service Worker, app.fetch works as is.",
            ],
            href: "/docs/runtimes/bun",
        },
        {
            title: "Errors that teach",
            desc: "The line and the fix, in English or Japanese.",
            points: [
                "In development mode, you see the line that threw and the code around it.",
                "Hints for common causes and fixes, in English and Japanese.",
                "In production, it returns only a 500 and shows nothing inside.",
            ],
            href: "/docs/dev/error-pages",
        },
        {
            title: "Onion timeline",
            desc: "See which middleware took the time, at /_senri.",
            points: [
                "Open /_senri to see the requests that came in.",
                "Pick one to see the order and time of each middleware and the handler, as nested bars.",
                "It is also in the Server-Timing header, so your browser's dev tools show it too.",
            ],
            href: "/docs/dev/timeline",
        },
        {
            title: "Typed client",
            desc: "Types and completion for callers, from your route table.",
            points: [
                "Pass the type of a defineRoutes() table straight to the client.",
                "Paths, parameters, bodies and responses are typed and completed.",
                "A small client: one function, no Proxy.",
            ],
            href: "/docs/typed-api/client",
        },
        {
            title: "OpenAPI",
            desc: "An API description from the same table.",
            points: [
                "Make an OpenAPI 3.1 document from the same table.",
                "Schemas from Zod, ArkType and others are converted with Standard JSON Schema.",
                "Give it to Scalar or Swagger UI for docs you can try.",
            ],
            href: "/docs/typed-api/openapi",
        },
        {
            title: "Ready for production",
            desc: "OpenTelemetry, Prometheus and WebSocket.",
            points: [
                "otel() makes a span for each request. With middlewareSpans: true, the onion becomes the trace.",
                "metrics() and metricsHandler() expose Prometheus metrics.",
                "WebSocket is written the same way on Bun, Deno, Node.js (ws) and Workers.",
            ],
            href: "/docs/production/otel",
        },
    ],
    oaOps: ["Get a user", "Create a user", "Delete a user"],
    patAria: "Common patterns",
    prev: "Previous",
    next: "Next",
    slideOf: (n: number, total: number) => `${n} of ${total}`,
    slides: [
        { title: "Return it, get JSON", desc: "Return an object and it becomes a JSON response." },
        { title: "Protect in one line", desc: "CORS and security headers are one use away." },
        { title: "Keep streaming", desc: "Server-Sent Events, with a heartbeat on by default." },
        { title: "Big files, bit by bit", desc: "Read parts one at a time without loading it all into memory." },
    ],
    tlLead: "Step by step, so far.",
    tlAll: "All releases →",
    tlPlanned: "Planned",
    releases: {
        ippo: { title: "Ippo", desc: "A meta-framework for React and Vue, running on Senri." },
        "0.3.1": { title: "Types fixed for JSR", desc: "WebSocket types now suit JSR, and the create-senri templates use 0.3." },
        "0.3.0": { title: "Body limits and cleaner types", desc: "Bodies are limited to 1 MiB by default. The client types responses by status." },
        "0.2.23": { title: "OpenTelemetry and Prometheus", desc: "Traces and metrics are now available." },
        "0.2.22": { title: "Typed client and OpenAPI", desc: "JWT, CSRF, WebSocket and more: what production needs." },
        site: { title: "senri.skyia.jp is live", desc: "Docs in Japanese and English." },
        "0.2.18": { title: "Multipart", desc: "Read big files bit by bit." },
        "0.2.0": { title: "Into the browser", desc: "It now runs in a Service Worker too." },
        "0.1.0": { title: "First release", desc: "Published on npm and JSR." },
    },
    ctaH: "Get started.",
    proverb: "A journey of a thousand miles begins with a single step.",
    footBrand: "A TypeScript framework built on web standards.",
    ogTopDesc: "The same code runs on Bun, Node.js, Deno, Workers and browsers.",
    ogDocs: "Docs",
    ogBlog: "Blog",
    ogBlogDesc: "Release announcements and more",
};

export const gridDict: Record<Lang, GridDict> = { ja, en };
