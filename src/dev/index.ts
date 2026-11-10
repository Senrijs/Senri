/**
 * Development mode: error pages, a 404 page with suggestions, the `/_senri` dashboard,
 * `Server-Timing` headers and detailed error messages.
 * The core never imports this entry, so it stays out of your bundle unless you import it.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { devtools } from "@senrijs/senri/dev";
 *
 * const app = createApp({ dev: devtools() });
 * ```
 *
 * @module
 */
// @senrijs/senri/dev の入口。開発モードの機能(エラーページ・404 ページ・/_senri ダッシュボード・Server-Timing・
// 詳しいエラー)は、すべてここから入る。本体(@senrijs/senri)はこのファイルを一切 import しない
//
//   import { createApp } from "@senrijs/senri";
//   import { devtools } from "@senrijs/senri/dev";
//
//   const app = createApp({ dev: devtools() });
//
// NODE_ENV=production のとき devtools() は何もしない(undefined を返す)ので、消し忘れても本番に開発ページは出ない
// NODE_ENV が development / test のときだけ、全部のリクエストに開発用の出力をする。それ以外(未設定を含む)は、
// localhost へのリクエストのときだけ開発用の出力をする(それ以外は、そのリクエストだけ本番と同じに振る舞う)
// Cloudflare Workers とブラウザ(process がない環境)では NODE_ENV が読めないので、いつも localhost のときだけ
import type { AppCore, DevHooks, DevInstalled, Resolved } from "../app.ts";
import { Context, type ExecutionContext } from "../context.ts";
import { compose, type Layer, type Trace } from "../compose.ts";
import { defaultNotFound, defaultOnError, errorCode, HttpError, type ErrorHandler } from "../errors.ts";
import { compareRoutes } from "../router.ts";
import * as runtime from "../runtime.ts";
import { isLang, requestLang, terminalLang, type Lang } from "../lang.ts";
import { appendVary, editable } from "../middleware/response.ts";
import { ValidationError } from "../validate.ts";
import { createDashboard } from "./dashboard/index.ts";
import { registerDashboard } from "./registry.ts";
import { explain } from "./explain.ts";
import { devNotFound } from "./not-found.ts";
import { finishErrorPage, withErrorPage } from "./pages.ts";
import { routeWarnings } from "./route-warnings.ts";
import { serverMessage } from "./server-messages.ts";
import { serverTimingHeader, withServerTiming } from "./server-timing.ts";
import { checkSchemas, describeValidation } from "./validation.ts";
import { isLoopback, remoteAddress } from "./dashboard/access.ts";

// 計測で、いちばん内側の層に付ける名前(ダッシュボードの玉ねぎタイムラインに出る)
const INNER_NAME: Record<Resolved["kind"], string> = {
    route: "handler",
    notFound: "notFound",
    methodNotAllowed: "405",
    options: "options",
    badRequest: "400",
    notImplemented: "501",
};

// どのリクエストに開発用の出力をするか
// - all: 全部(NODE_ENV が development / test)
// - local: URL のホスト名が localhost で、かつ接続元が loopback のときだけ(Node / Bun / Deno で、それ以外の NODE_ENV。未設定を含む)
//   request.url のホスト名は Host ヘッダーから作られる(だれでも付けられる)ので、接続元も見る
// - localUrl: URL のホスト名が localhost のときだけ(Workers とブラウザ。URL はプラットフォームが決めるので偽装できない)
type Scope = "all" | "local" | "localUrl";

/** Options for {@link devtools}. */
export type DevtoolsOptions = {
    /**
     * Fixes the language of the development pages and terminal messages, instead of choosing it automatically.
     *
     * Without it, pages follow the request's `Accept-Language`, and terminal messages follow `LC_ALL`, `LC_MESSAGES`, `LANG`
     * and then the OS language. English is used when no language can be decided. Bun on Windows does not report the OS
     * language, so set this or `LANG` there to get Japanese. Errors that also appear in production are not translated.
     */
    lang?: Lang;
};

export type { Lang };

// 開発モードのフックを作る。本番(NODE_ENV=production)では undefined を返すので、開発モードにならない
// Deno で NODE_ENV を読む許可がないときは、本番かどうか分からないので、開発モードにしない(案内を1行出す)
/**
 * Creates the development-mode hooks to pass to `createApp({ dev: devtools() })`.
 *
 * - `NODE_ENV=production`: returns `undefined` (development mode stays off)
 * - `NODE_ENV=development` or `test`: development output for every request
 * - `NODE_ENV` not set, or any other value: development output only for requests to localhost
 *   (the URL's host is localhost **and** the client address is a loopback address); other requests behave as in production
 *
 * `NODE_ENV` is read once, when `devtools()` is called. The first time a request is answered as in production
 * because it is not to localhost, a one-line warning is printed (once per app).
 * When `NODE_ENV` cannot be read (Deno without `--allow-env=NODE_ENV`), it returns `undefined` and prints a warning.
 * On Cloudflare Workers and in the browser, where `NODE_ENV` is not available, development output is used
 * only for requests to a localhost URL (see {@link isLocalUrl}). The `/_senri` dashboard is not available on Cloudflare Workers.
 *
 * Throws a `TypeError` when `lang` is not `"ja"` or `"en"`.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { devtools } from "@senrijs/senri/dev";
 *
 * const app = createApp({ dev: devtools() });
 * app.get("/", () => "hi");
 * ```
 */
export function devtools(options: DevtoolsOptions = {}): DevHooks | undefined {
    const fixed = options.lang;
    if (fixed !== undefined && !isLang(fixed)) throw new TypeError('devtools(): lang must be "ja" or "en"');
    if (!runtime.canReadEnv("NODE_ENV")) {
        console.warn(`[senri] ${serverMessage(fixed ?? terminalLang(), "warn.envUnreadable")}`);
        return undefined;
    }
    const nodeEnv = runtime.env("NODE_ENV");
    if (nodeEnv === "production") return undefined;
    // Workers(nodejs_compat で process があっても、NODE_ENV はふつう入っていない)とブラウザは、本番かどうか分からない
    // それ以外は、development / test と明示したときだけ全部。未設定や staging などは、本番に出ているかもしれないので localhost だけ
    const scope: Scope =
        runtime.isWorkers() || typeof (globalThis as { process?: unknown }).process === "undefined"
            ? "localUrl"
            : nodeEnv === "development" || nodeEnv === "test"
              ? "all"
              : "local";
    return { install: (core) => install(core, scope, nodeEnv, fixed) };
}

// 開発用の出力をしてよい、localhost へのリクエストか(scope は "all" 以外)
function isLocalRequest(req: Request, info: unknown, scope: Scope): boolean {
    if (!isLocalUrl(req.url)) return false;
    return scope === "localUrl" || isLoopback(remoteAddress(req, info));
}

// request.url のホスト名が localhost か(Host や X-Forwarded-Host などのヘッダーは見ない。だれでも付けられるので)
// - Workers: Cloudflare は登録されたドメインのリクエストしか渡さないので、本番に localhost は来ない。wrangler dev は localhost
// - ブラウザ: Service Worker が受けるリクエストの URL は、そのサイトのオリジン。開発中だけ localhost になる
/**
 * Whether the URL's host is `localhost`, `*.localhost`, `[::1]` or `127.x.x.x`.
 * Only the URL is checked, not headers such as `Host`. Returns `false` for an invalid URL.
 */
export function isLocalUrl(url: string): boolean {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }
    return (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "[::1]" ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
}

// パスが /_senri か /_senri/... なら、"_senri" より後ろのセグメント。そうでなければ null
function underDashboard(c: Context): readonly string[] | null {
    try {
        return c.segments[0] === "_senri" ? c.segments.slice(1) : null;
    } catch {
        return null;
    }
}

// 層ごとの時間を c.timings に記録する(src/compose.ts の Trace)
function measure(c: Context, origin: number, layers: Layer[], innerName: string): Trace {
    const starts: number[] = [];
    const inner: number[] = [];
    return {
        enter(i) {
            starts[i] = performance.now();
            inner[i] = 0;
        },
        down(i) {
            const start = performance.now();
            return () => (inner[i]! += performance.now() - start);
        },
        leave(i, failed, stopped) {
            const total = performance.now() - starts[i]!;
            c.timings[i] = {
                name: layers[i]?.name ?? innerName,
                total,
                self: total - inner[i]!,
                failed,
                start: starts[i]! - origin,
                stopped,
            };
        },
    };
}

// 開発モードの既定の onError。本番の固定の文言の代わりに、詳しい文言を返す
// (ブラウザから開いた 5xx は、withErrorPage がエラーページにする)
const devOnError =
    (langOf: (c: Context) => Lang): ErrorHandler =>
    (err, c) => {
        if (err instanceof ValidationError) return c.text(describeValidation(err, langOf(c)));
        if (err instanceof HttpError) {
            switch (errorCode(err)) {
                case "method_not_allowed":
                    return c.text(serverMessage(langOf(c), "res.methodNotAllowed", { method: c.req.method, path: c.path, allow: err.headers.get("allow") ?? "" }));
                case "query_no_body":
                    return c.text(serverMessage(langOf(c), "res.queryNoBody"));
                case "query_no_type":
                    return c.text(serverMessage(langOf(c), "res.queryNoType"));
                case "csrf_rejected":
                    return c.text(serverMessage(langOf(c), "res.csrfRejected", { method: c.req.method, origin: c.req.headers.get("origin") ?? "?" }));
                case "websocket_origin_rejected":
                    return c.text(serverMessage(langOf(c), "res.websocketOriginRejected", { origin: c.req.headers.get("origin") ?? "?" }));
                case "websocket_not_upgrade":
                    return c.text(serverMessage(langOf(c), "res.websocketNotUpgrade", { path: c.path }));
            }
            return c.text(err.message);
        }
        explain(err, langOf(c));
        return c.text(`500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
    };

// scope: どのリクエストに開発用の出力をするか / nodeEnv: 知らせるときに出す、NODE_ENV の値 / fixed: devtools({ lang })
function install(core: AppCore, scope: Scope, nodeEnv: string | undefined, fixed: Lang | undefined): DevInstalled {
    const { app } = core;
    // ターミナルの言語はアプリごとに1回だけ決める
    const terminal = fixed ?? terminalLang();
    const langOfRequest = (req: Request) => fixed ?? requestLang(req);
    // Accept-Language で文言を変えたリクエスト(レスポンスに Vary を付ける)
    const localized = new WeakSet<Context>();
    const langOf = (c: Context): Lang => {
        if (!fixed) localized.add(c);
        return langOfRequest(c.req);
    };
    // 本番と同じに振る舞うリクエスト(localhost でないもの)
    const quiet = new WeakSet<Context>();
    // localhost でないので開発用の出力をしなかったことを、1回だけ知らせる(Node / Bun / Deno のとき。Workers とブラウザはいつもなので出さない)
    let warned = scope !== "local";
    const warnOnce = (req: Request) => {
        if (warned) return;
        warned = true;
        let host = "";
        try {
            host = new URL(req.url).host;
        } catch {}
        const env = nodeEnv === undefined ? serverMessage(terminal, "warn.notSet") : JSON.stringify(nodeEnv);
        console.warn(`[senri] ${serverMessage(terminal, "warn.localOnly", { env, host: JSON.stringify(host) })}`);
    };
    // 一覧は優先順位の順(静的なセグメントが先)。本体は登録順に持っている
    const sortedRoutes = () => [...core.routes()].sort(compareRoutes);

    // ルートが出揃ったあと(最初のリクエスト)に、書き間違いを確かめる
    // 数が変わったときだけ確かめ直す。同じ警告はアプリごとに1回だけ
    const warnedRoutes = new Set<string>();
    let checkedRoutes = -1;
    let checkedMiddlewares = -1;
    const warnRoutes = () => {
        const middlewares = app.middlewareList();
        const routes = core.routes();
        if (routes.length === checkedRoutes && middlewares.length === checkedMiddlewares) return;
        checkedRoutes = routes.length;
        checkedMiddlewares = middlewares.length;
        for (const text of routeWarnings(sortedRoutes(), middlewares, terminal)) {
            if (warnedRoutes.has(text)) continue;
            warnedRoutes.add(text);
            console.warn(`[senri] ${text}`);
        }
    };

    // ダッシュボード。Cloudflare Workers では作らない(接続元が分からず localhost 制限で開けないうえ、
    // リクエストごとに別の isolate で動くことがあり、記録が残らない)。/_senri はふつうの 404 になる
    const dashboard = runtime.isWorkers()
        ? null
        : createDashboard(
              {
                  routes: () => sortedRoutes().map((r) => ({ method: r.method, path: r.path, use: r.use?.map((l) => l.name) })),
                  middlewares: () => app.middlewareList(),
              },
              langOfRequest,
          );
    if (dashboard) registerDashboard(app, dashboard);

    async function fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response> {
        // 計測の基準になるリクエストの開始時刻
        const origin = performance.now();
        const time = Date.now();
        const c = new Context(req, info, ctx);
        if (scope !== "all" && !isLocalRequest(req, info, scope)) {
            warnOnce(req);
            return quietFetch(c);
        }
        warnRoutes();
        // /_senri 以下はダッシュボード。localhost から開いたときだけ、ミドルウェアを通さずに処理する
        // (開けないときは普通の処理に回すので、/_senri はないものとして 404 になる)。どちらも記録はしない
        const dashboardPath = underDashboard(c);
        if (dashboard && dashboardPath && dashboard.canOpen(req, info)) {
            return dashboard.handle(req, dashboardPath);
        }
        if (!dashboardPath) dashboard?.begin(c, info);

        // ミドルウェアより先にマッチして、c.route / c.params を見られるようにしておく
        const resolved = core.resolve(c);
        if (resolved.kind === "route") {
            c.route = resolved.route.path;
            c.params = resolved.params;
        }

        // ハンドラー・notFound・toResponse のどこで投げても、compose が onError に集める
        const layers = core.layers(c, resolved);
        const innerName = INNER_NAME[resolved.kind];
        const res = await compose(
            layers,
            c,
            () => core.inner(c, resolved),
            (err) => core.fail(err, c),
            measure(c, origin, layers, innerName),
        );
        // ミドルウェアを全部通ったあとなので、ここなら「通った順番」が揃っている
        const page = await finishErrorPage(c, res, () => langOf(c));
        // 層ごとの時間を Server-Timing に載せる(ブラウザの開発者ツールで見られる)
        const desc = resolved.kind === "route" ? `${resolved.route.method} ${resolved.route.path}` : innerName;
        const final = withServerTiming(
            c.finalize(page),
            serverTimingHeader(c.timings, { name: innerName, desc }, performance.now() - origin),
        );
        // ダッシュボードに記録する(失敗してもレスポンスには影響しない)
        await dashboard?.record(c, final, time, [
            ...layers.map((l) => ({ name: l.name, order: l.order ?? null })),
            { name: innerName, order: null },
        ]);
        if (!localized.has(c)) return final;
        const varied = editable(final);
        appendVary(varied.headers, "Accept-Language");
        return varied;
    }

    // 本番の fetch と同じ流れ(計測・記録・エラーページ・Server-Timing なし。onError / notFound も本番の既定になる)
    function quietFetch(c: Context): Promise<Response> {
        quiet.add(c);
        const resolved = core.resolve(c);
        if (resolved.kind === "route") {
            c.route = resolved.route.path;
            c.params = resolved.params;
        }
        return compose(core.layers(c, resolved), c, () => core.inner(c, resolved), (err) => core.fail(err, c)).then((res) => c.finalize(res));
    }

    const pageOnError = withErrorPage(devOnError(langOf), true);
    return {
        fetch,
        onError: (err, c) => (quiet.has(c) ? defaultOnError(err, c) : pageOnError(err, c)),
        notFound: (c) => (quiet.has(c) ? defaultNotFound(c) : devNotFound(c, sortedRoutes(), () => langOf(c))),
        checkRoute(method, path, schemas) {
            if (schemas) checkSchemas(path, schemas, terminal);
            // /_senri 以下はダッシュボードが使うので、登録しても呼ばれない。気づけるようにエラーにする
            if (dashboard && /^\/*_senri(\/|$)/.test(path)) {
                throw new Error(serverMessage(terminal, "route.reserved", { method, path }));
            }
        },
        explain: (err) => explain(err, terminal),
    };
}

