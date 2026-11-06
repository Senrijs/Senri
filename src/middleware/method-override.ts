// HTML のフォームから PUT / PATCH / DELETE を送れるようにする
// ルートはミドルウェアより先に決まるので、ミドルウェアでは間に合わない。app.fetch を包む
import type { ExecutionContext } from "../context.ts";
import { senriError } from "../errors.ts";

/** Options for {@link methodOverride}. */
export type MethodOverrideOptions = {
    // フォームの項目の名前。false なら本文を読まない
    /** The form field with the method. Default `"_method"`; `false` never reads the body. */
    form?: string | false;
    // false ならヘッダーを見ない
    /** The header with the method, checked before the form. Default `"X-HTTP-Method-Override"`; `false` ignores it. */
    header?: string | false;
    // 上書き先。GET / HEAD は本文を持てないので指定できない
    /** The methods a POST may become. Default `PUT`, `PATCH` and `DELETE`. `GET`, `HEAD`, `CONNECT` and `TRACE` are not accepted. */
    allow?: readonly string[];
};

type Target = {
    fetch(req: Request, info?: unknown, ctx?: ExecutionContext): Promise<Response>;
    routeList(): { method: string; path: string }[];
};

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN = ["GET", "HEAD", "CONNECT", "TRACE", "TRACK"];

// これより大きいフォームは読まない(ミドルウェアの bodyLimit より前に動くので)
const MAX_FORM = 64 * 1024;

// 複製した本文を、上限まで読む。元の本文は使い切らない
async function readForm(req: Request, name: string): Promise<string | null> {
    const type = req.headers.get("content-type")?.split(";", 1)[0]!.trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded" || req.body === null) return null;
    const reader = req.clone().body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_FORM) return null;
            chunks.push(value);
        }
    } catch {
        // 本文のエラーは、読むアプリの側で今までどおり起きる
        return null;
    } finally {
        reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new URLSearchParams(new TextDecoder().decode(bytes)).get(name);
}

/**
 * Wraps an app so that a `POST` can act as another method, for HTML forms, which can only send `GET` and `POST`. The method
 * comes from the `X-HTTP-Method-Override` header or the `_method` form field. Routes are chosen before middleware runs, so
 * this wraps `app.fetch` instead of being a middleware. Pass the result to your runtime in place of the app.
 *
 * - Only `POST` can be overridden, and only to the methods in `allow`. Anything else is passed through unchanged
 * - The form is read from a copy, so handlers can still read `c.req`'s body. Only `application/x-www-form-urlencoded`
 *   bodies up to 64 KiB are read. **`multipart/form-data` is not read**, so as not to hold large uploads in memory: use the
 *   header for those
 * - **On Node.js, every request then leaves the path that creates no `Request` or `Response`**, including requests that
 *   are not `POST`, since the app is wrapped
 * - This lets a form on another site send `DELETE` to you just as it could send `POST`, so protect these routes against
 *   cross-site requests in the same way
 *
 * Throws when the options are invalid, or both `form` and `header` are `false`.
 *
 * @example
 * ```ts
 * import { createApp, methodOverride } from "@senrijs/senri";
 * import { serve } from "@senrijs/senri/serve";
 *
 * const app = createApp();
 * app.delete("/posts/:id", ({ id }) => `Deleted ${id}`);
 *
 * // <form method="post" action="/posts/1"><input type="hidden" name="_method" value="DELETE"></form>
 * serve(methodOverride(app));
 *
 * // On Cloudflare Workers: export default methodOverride(app);
 * ```
 */
export function methodOverride<T extends Target>(app: T, options: MethodOverrideOptions = {}): Pick<T, "fetch" | "routeList"> {
    const form = options.form ?? "_method";
    const header = options.header ?? "X-HTTP-Method-Override";
    const allow = options.allow ?? ["PUT", "PATCH", "DELETE"];
    const valid =
        (form === false || (typeof form === "string" && form !== "")) &&
        (header === false || (typeof header === "string" && TOKEN.test(header))) &&
        (form !== false || header !== false) &&
        Array.isArray(allow) &&
        allow.length > 0 &&
        allow.every((method: unknown) => typeof method === "string" && TOKEN.test(method) && !FORBIDDEN.includes(method.toUpperCase()));
    if (!valid) throw senriError("method_override_options", "methodOverride(): invalid options");
    const allowed = new Set(allow.map((method) => method.toUpperCase()));
    const accepts = (method: string | null | undefined): method is string => typeof method === "string" && allowed.has(method.toUpperCase());

    const wrapped: Target = {
        async fetch(req, info, ctx) {
            if (req.method !== "POST") return app.fetch(req, info, ctx);
            let method = header === false ? null : req.headers.get(header);
            if (!accepts(method) && form !== false) method = await readForm(req, form);
            if (!accepts(method)) return app.fetch(req, info, ctx);
            const rebuilt = new Request(req, { method: method.toUpperCase() });
            // Bun は、作り直した Request からは接続元を読めない
            const server = info as { requestIP?: unknown } | null | undefined;
            const passed = typeof server?.requestIP === "function" ? { requestIP: () => (info as { requestIP(r: Request): unknown }).requestIP(req) } : info;
            return app.fetch(rebuilt, passed, ctx);
        },
        routeList: () => app.routeList(),
    };
    return wrapped as Pick<T, "fetch" | "routeList">;
}
