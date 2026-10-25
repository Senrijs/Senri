// エラーページに埋め込むデータを組み立てる
import type { Context } from "../context.ts";
import { conversionOriginOf, HttpError } from "../errors.ts";
import { guessEditor } from "./editor.ts";
import { hintFor } from "./hints.ts";
import type { ErrorPageData, PageFrame } from "./page-data.ts";
import * as runtime from "./runtime.ts";
import { readCodeFrame } from "./source.ts";
import { parseStack, type StackFrame } from "./stack.ts";

// Bun などは statusText が空のことがあるので、よく使うものだけ用意しておく
const STATUS_TEXT: Record<number, string> = {
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
};

// 本番(dev: false)で、このエラーのときに返る本文(errors.ts の defaultOnError と同じ考え方)
function productionText(err: unknown): string {
    return err instanceof HttpError ? err.message : "500 Internal Server Error";
}

function toPageFrame(frame: StackFrame, root: string | null): PageFrame {
    const prefix = root ? `${root.replace(/\/$/, "")}/` : null;
    const fold = (p: string) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
    const display = prefix && fold(frame.file).startsWith(fold(prefix)) ? frame.file.slice(prefix.length) : frame.file;
    return { ...frame, display };
}

function requestPath(c: Context): string {
    try {
        return c.path;
    } catch {
        // デコードできないパス(400)でも、ページは出せるように
        return c.req.url;
    }
}

export async function buildErrorPageData(err: unknown, c: Context, res: Response): Promise<ErrorPageData> {
    const root = runtime.cwd();
    const error =
        err instanceof Error ? { name: err.name, message: err.message } : { name: "throw", message: String(err) };
    const stack = err instanceof Error && typeof err.stack === "string" ? parseStack(err.stack) : [];
    const frames = stack.map((f) => toPageFrame(f, root));
    // 返した値をレスポンスにする途中で失敗したときは、スタックの利用者のコードは
    // 「返した場所」ではなく外側のミドルウェアの `await next()` なので、場所としては出さない
    const origin = conversionOriginOf(err);
    const first = origin ? null : (stack.find((f) => f.kind === "user") ?? null);

    return {
        kind: "error",
        status: res.status,
        statusText: res.statusText || STATUS_TEXT[res.status] || "",
        // いちばん外側の層の total が、リクエスト全体の時間
        durationMs: c.timings[0]?.total ?? null,
        error,
        origin,
        location: first ? toPageFrame(first, root) : null,
        code: first ? await readCodeFrame(first, { root }) : null,
        hint: hintFor(err),
        frames,
        request: {
            method: c.req.method,
            path: requestPath(c),
            route: c.route ?? null,
            params: c.params,
            userAgent: c.req.headers.get("user-agent"),
        },
        layers: c.timings.map((t) => ({ name: t.name, self: t.self, total: t.total, failed: t.failed })),
        editor: guessEditor(),
        root,
        production: productionText(err),
    };
}
