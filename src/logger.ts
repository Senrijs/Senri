import type { Middleware } from "./context.ts";

const C = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
};

const METHOD_COLOR: Record<string, string> = {
    GET: C.green,
    POST: C.cyan,
    PUT: C.yellow,
    DELETE: C.red,
    PATCH: C.magenta,
};

type LoggerOptions = {
    format?: "pretty" | "json";
    color?: boolean;
    slow?: number;
};

// ログには、届いたままのパスを出す(c.path はデコード済みで、不正なリクエストだと 400 を投げるため)
// Bun は不正な Host のとき req.url を相対 URL にするので、URL として読めなければそのまま出す
function rawPath(req: Request): string {
    try {
        return new URL(req.url).pathname;
    } catch {
        return req.url;
    }
}

export function logger(options: LoggerOptions = {}): Middleware {
    const format = options.format ?? "pretty";
    const color = options.color ?? true;
    const slow = options.slow ?? 500;

    const paint = (code: string, text: string) => 
        color ? `${code}${text}${C.reset}` : text;

    function statusColor(status: number): string {
        if (status >= 500) return C.red;
        if (status >= 400) return C.yellow;
        if (status >= 300) return C.cyan;
        return C.green;
    }

    function pinoLevel(status: number): number {
        if (status >= 500) return 50;
        if (status >= 400) return 40;
        return 30;
    }

    // 名前付きの関数にしておくと、ダッシュボードなどで "logger" と表示できる
    return async function logger(c, next) {
        const start = Date.now();
        const res = await next();
        const ms = Date.now() - start;
        const method = c.req.method;
        const path = rawPath(c.req);

        // pino 形式のエラー(エラーがなければ undefined)
        const err = c.error instanceof Error
            ? { type: c.error.name, message: c.error.message, stack: c.error.stack }
            : c.error !== undefined
                ? { message: String(c.error) }
                : undefined;

        if (format === "json") {
            console.log(JSON.stringify({
                level: pinoLevel(res.status),
                time: Date.now(),
                req: { method, url: path },
                res: { statusCode: res.status },
                responseTime: ms,
                err,
                msg: err ? "request errored" : "request completed",
            }));
            return;
        }

        const time = new Date().toTimeString().slice(0, 8);

        console.log([
            paint(C.dim, time),
            paint(METHOD_COLOR[method] ?? C.bold, method.padEnd(7)),
            path.padEnd(24),
            paint(statusColor(res.status), String(res.status)),
            paint(ms > slow ? C.red : C.dim, `${ms}ms`.padStart(6)),
        ].join(" "));

        // エラーがあったら、その下に赤で詳細を出す
        if (err) {
            console.log(paint(C.red, `  ${err.stack ?? err.message}`));
        }
    };
}

type RouteInfo = { method: string; path: string };

const ACCENT = "\x1b[38;2;227;65;43m";

export function showRoutes(
    app: { routeList(): RouteInfo[] },
    url: string,
    options: { color?: boolean } = {},
) {
    const color = options.color ?? true;
    const paint = (code: string, text: string) =>
        color ? `${code}${text}${C.reset}` : text;

    // パスのアルファベット順 → 同じパスならメソッド順
    const list = [...app.routeList()].sort(
        (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    );

    // ":id" みたいなパラメーター部分だけ色を付ける
    const highlight = (path: string) =>
        path
            .split("/")
            .map((seg) => (seg.startsWith(":") ? paint(C.cyan, seg) : seg))
            .join("/");

    console.log("");
    console.log(`  ${paint(C.bold, "senr")}${paint(ACCENT, "/")}  ${paint(C.green, "ready")}  ${url}`);
    console.log("");
    for (const r of list) {
        console.log(`    ${paint(METHOD_COLOR[r.method] ?? C.bold, r.method.padEnd(7))} ${highlight(r.path)}`);
    }
    console.log("");
}