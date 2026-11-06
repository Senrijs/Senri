// 本文から ETag を作って、変わっていなければ 304 を返す
import type { Middleware } from "../context.ts";
import { headerOf, markPlainSafe, methodOf, PlainResponse } from "../plain.ts";
import { peekBody } from "./read-body.ts";
import { editable, matchesEtag } from "./response.ts";

/** Options for {@link etag}. */
export type EtagOptions = {
    // 弱い ETag(W/"...")にするか。serveStatic と同じく既定は弱い ETag。compress() と一緒に使っても矛盾しない
    /** Send a weak ETag (`W/"..."`), as `serveStatic` does. Default `true`. Weak ETags stay valid when the body is compressed. */
    weak?: boolean;
};

// これより大きい本文には付けない
const MAX_SIZE = 1024 * 1024;

// 304 では本文を送らないので、本文についてのヘッダーを消す(ほかは 200 のときと同じものを残す)
const BODY_HEADERS = ["content-type", "content-length", "content-encoding", "content-language", "content-range"];

const encoder = new TextEncoder();

// 暗号用のハッシュは要らない(同じ URL の本文が変わったことが分かればよい)。crypto.subtle は非同期で、Node では待ちが長い
// 2つの 32 bit を混ぜる(cyrb53 と同じ形)。本文の長さも ETag に入れるので、取り違える心配はまずない
function hashOf(bytes: Uint8Array): string {
    let a = 0xdeadbeef;
    let b = 0x41c6ce57;
    for (let i = 0; i < bytes.length; i++) {
        a = Math.imul(a ^ bytes[i]!, 2654435761);
        b = Math.imul(b ^ bytes[i]!, 1597334677);
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/**
 * Middleware that adds an `ETag` to `GET` responses with a 2xx status, computed from the body, and answers `304 Not Modified` to a matching
 * `If-None-Match`. A response that already has an `ETag` keeps it.
 *
 * - The handler runs on every request: this saves sending the body, not the work of making it
 * - Bodies over 1 MiB and streams get no `ETag`. A body counts as a stream if it cannot be read within a few
 *   milliseconds, so this can delay the start of a stream by up to 5 ms. `text/event-stream` is never read
 * - `HEAD` responses get no `ETag`, because their body is already gone at this point. `If-None-Match` still applies to
 *   a `HEAD` response that has its own `ETag`
 * - With `compress()`, register `compress()` first
 *
 * @example
 * ```ts
 * import { createApp, etag } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(etag());
 * app.get("/posts", () => listPosts());
 * ```
 */
export function etag(options: EtagOptions = {}): Middleware {
    const prefix = (options.weak ?? true) ? 'W/"' : '"';

    return markPlainSafe<Middleware>(async function etag(c, next) {
        const method = methodOf(c);
        if (method !== "GET" && method !== "HEAD") return next();
        let res = await next();
        const { status } = res;
        if (status < 200 || status > 299 || status === 204 || status === 205 || status === 206) return res;

        let tag = res.headers.get("etag");
        if (tag === null) {
            if (res.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) return res;
            // Node の近道では本文が文字列なので、Response を作らずに計算できる
            const body = res instanceof PlainResponse ? encoder.encode(res.body as string) : await peekBody(res, MAX_SIZE);
            if (!(body instanceof Uint8Array) || body.length > MAX_SIZE) return res;
            tag = `${prefix}${body.length.toString(16)}-${hashOf(body)}"`;
            res = editable(res);
            res.headers.set("etag", tag);
        }

        const ifNoneMatch = headerOf(c, "if-none-match");
        if (ifNoneMatch === null || !matchesEtag(ifNoneMatch, tag)) return res;
        // 送らない本文のストリームを閉じる(Node の近道では文字列)
        if (res instanceof Response) res.body?.cancel().catch(() => {});
        const headers = new Headers(res.headers);
        for (const name of BODY_HEADERS) headers.delete(name);
        return new Response(null, { status: 304, headers });
    });
}
