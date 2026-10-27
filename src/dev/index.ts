// @senrijs/senri/dev の入口。開発モードの機能(エラーページ・404 ページ・/_senri ダッシュボード・Server-Timing・
// 日本語の詳しいエラー)は、すべてここから入る。本体(@senrijs/senri)はこのファイルを一切 import しない
//
//   import { createApp } from "@senrijs/senri";
//   import { devtools } from "@senrijs/senri/dev";
//
//   const app = createApp({ dev: devtools() });
//
// NODE_ENV=production のとき devtools() は何もしない(undefined を返す)ので、消し忘れても本番に開発ページは出ない
import type { AppCore, DevHooks, DevInstalled, Resolved } from "../app.ts";
import { Context, type ExecutionContext } from "../context.ts";
import { compose, type Layer, type Trace } from "../compose.ts";
import { errorCode, HttpError, type ErrorHandler } from "../errors.ts";
import { compareRoutes } from "../router.ts";
import * as runtime from "../runtime.ts";
import { ValidationError } from "../validate.ts";
import { createDashboard, type Dashboard } from "./dashboard/index.ts";
import { explain } from "./explain.ts";
import { devNotFound } from "./not-found.ts";
import { finishErrorPage, withErrorPage } from "./pages.ts";
import { serverTimingHeader, withServerTiming } from "./server-timing.ts";
import { checkSchemas, describeValidation } from "./validation.ts";

export type { Dashboard } from "./dashboard/index.ts";

// 計測で、いちばん内側の層に付ける名前(ダッシュボードの玉ねぎタイムラインに出る)
const INNER_NAME: Record<Resolved["kind"], string> = {
    route: "handler",
    notFound: "notFound",
    methodNotAllowed: "405",
    options: "options",
    badRequest: "400",
    notImplemented: "501",
};

// アプリとダッシュボードの対応(テストで中身を確かめるのに使う)
const dashboards = new WeakMap<object, Dashboard>();

export async function dashboardOf(app: object): Promise<Dashboard | undefined> {
    return dashboards.get(app);
}

// 開発モードのフックを作る。本番(NODE_ENV=production)では undefined を返すので、開発モードにならない
// Deno で NODE_ENV を読む許可がないときは、本番かどうか分からないので、開発モードにしない(案内を1行出す)
export function devtools(): DevHooks | undefined {
    if (!runtime.canReadEnv("NODE_ENV")) {
        console.warn(
            "[senri] devtools() is off: NODE_ENV is not readable. Run with --allow-env=NODE_ENV to enable it. / NODE_ENV を読めないので devtools() は無効です。--allow-env=NODE_ENV を付けると使えます",
        );
        return undefined;
    }
    if (runtime.env("NODE_ENV") === "production") return undefined;
    return { install };
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
const devOnError: ErrorHandler = (err, c) => {
    if (err instanceof ValidationError) return c.text(describeValidation(err));
    if (err instanceof HttpError) {
        switch (errorCode(err)) {
            case "method_not_allowed":
                return c.text(`405 Method Not Allowed: ${c.req.method} ${c.path}\n${err.headers.get("allow")} ならあります`);
            case "query_no_body":
                return c.text("400 Bad Request: QUERY リクエストにボディがありません\nQUERY は、検索の条件をボディに入れて送るメソッドです");
            case "query_no_type":
                return c.text(
                    "415 Unsupported Media Type: QUERY リクエストに Content-Type がありません\nボディの形式を指定してください(例: Content-Type: application/json)",
                );
        }
        return c.text(err.message);
    }
    explain(err);
    return c.text(`500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
};

function install(core: AppCore): DevInstalled {
    const { app } = core;
    // 一覧は優先順位の順(静的なセグメントが先)。本体は登録順に持っている
    const sortedRoutes = () => [...core.routes()].sort(compareRoutes);

    // ダッシュボード。Cloudflare Workers では作らない(接続元が分からず localhost 制限で開けないうえ、
    // リクエストごとに別の isolate で動くことがあり、記録が残らない)。/_senri はふつうの 404 になる
    const dashboard = runtime.isWorkers()
        ? null
        : createDashboard({
              routes: () => sortedRoutes().map((r) => ({ method: r.method, path: r.path })),
              middlewares: () => app.middlewareList(),
          });
    if (dashboard) dashboards.set(app, dashboard);

    async function fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response> {
        // 計測の基準になるリクエストの開始時刻
        const origin = performance.now();
        const time = Date.now();
        const c = new Context(req, info, ctx);
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
        const layers = core.layers(c);
        const innerName = INNER_NAME[resolved.kind];
        const res = await compose(
            layers,
            c,
            () => core.inner(c, resolved),
            (err) => core.fail(err, c),
            measure(c, origin, layers, innerName),
        );
        // ミドルウェアを全部通ったあとなので、ここなら「通った順番」が揃っている
        const page = await finishErrorPage(c, res);
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
        return final;
    }

    return {
        fetch,
        onError: withErrorPage(devOnError, true),
        notFound: (c) => devNotFound(c, sortedRoutes()),
        checkRoute(method, path, schemas) {
            if (schemas) checkSchemas(path, schemas);
            // /_senri 以下はダッシュボードが使うので、登録しても呼ばれない。気づけるようにエラーにする
            if (dashboard && /^\/*_senri(\/|$)/.test(path)) {
                throw new Error(`${method} ${path}: /_senri 以下は、開発モードではダッシュボード用に予約されています`);
            }
        },
        explain,
    };
}

