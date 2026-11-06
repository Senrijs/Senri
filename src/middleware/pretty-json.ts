// ?pretty のときに JSON を読みやすくする
import type { Middleware } from "../context.ts";
import { senriError } from "../errors.ts";
import { markPlainSafe, PlainResponse, urlOf } from "../plain.ts";
import { peekBody } from "./read-body.ts";

/** Options for {@link prettyJSON}. */
export type PrettyJSONOptions = {
    /** How many spaces to indent by, from 1 to 10. Default `2`. */
    space?: number;
    /** The query parameter that turns this on. Its value is not read, so `?pretty=false` also turns it on. Default `"pretty"`. */
    query?: string;
};

const JSON_TYPE = /^application\/(?:[\w.-]+\+)?json\s*(?:;|$)/i;

// これより大きい本文は整形しない(クライアントが ?pretty で CPU を使わせないように)
const MAX_SIZE = 1024 * 1024;

function format(text: string, space: number): string | null {
    try {
        return JSON.stringify(JSON.parse(text), null, space);
    } catch {
        return null;
    }
}

/**
 * Middleware that indents JSON responses when the URL has `?pretty`, for reading them in a browser. Without the parameter
 * it only reads the URL.
 *
 * - It applies to `application/json` and `+json` types. Bodies over 1 MiB, streams, and compressed or invalid bodies are left
 *   as they are
 * - The JSON is parsed and written again, so numbers too large for JavaScript can change. Only the formatted response is
 *   affected
 * - Register it after `compress()` and `etag()`, so they work on the formatted body
 *
 * Throws when `space` is not an integer from 1 to 10, or `query` is empty.
 *
 * @example
 * ```ts
 * import { createApp, prettyJSON } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(prettyJSON());
 * app.get("/user", () => ({ name: "yahari" })); // /user?pretty is indented
 * ```
 */
export function prettyJSON(options: PrettyJSONOptions = {}): Middleware {
    const space = options.space ?? 2;
    const query = options.query ?? "pretty";
    if (!Number.isInteger(space) || space < 1 || space > 10 || typeof query !== "string" || query === "") {
        throw senriError("pretty_json_options", "prettyJSON(): invalid options");
    }

    return markPlainSafe<Middleware>(async function prettyJSON(c, next) {
        const res = await next();
        const url = urlOf(c);
        const at = url.indexOf("?");
        if (at === -1 || !new URLSearchParams(url.slice(at + 1)).has(query)) return res;

        // Node の近道: 文字列を差し替えるだけで、Response を作らない
        if (res instanceof PlainResponse) {
            const plain = res as unknown as PlainResponse;
            if (!JSON_TYPE.test(plain.type) || plain.body.length > MAX_SIZE) return res;
            const pretty = format(plain.body, space);
            if (pretty !== null) plain.body = pretty;
            return res;
        }

        if (!JSON_TYPE.test(res.headers.get("content-type") ?? "") || res.headers.has("content-encoding")) return res;
        const body = await peekBody(res, MAX_SIZE);
        if (!(body instanceof Uint8Array)) return res;
        const pretty = format(new TextDecoder().decode(body), space);
        if (pretty === null) return res;
        res.body?.cancel().catch(() => {});
        const headers = new Headers(res.headers);
        headers.delete("content-length");
        return new Response(pretty, { status: res.status, statusText: res.statusText, headers });
    });
}
