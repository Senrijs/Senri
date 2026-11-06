// レスポンスの本文を圧縮する(CompressionStream。どのランタイムでも使える)
import type { Middleware } from "../context.ts";
import { senriError } from "../errors.ts";
import { headerOf, markPlainSafe, methodOf, PlainResponse } from "../plain.ts";
import { peekBody } from "./read-body.ts";
import { appendVary, editable } from "./response.ts";

type Encoding = "gzip" | "deflate";

/** Options for {@link compress}. */
export type CompressOptions = {
    // これより小さい本文は圧縮しない(圧縮すると、かえって大きくなることがある)
    /** Bodies smaller than this many bytes are not compressed. Default `1024`. */
    threshold?: number;
    /** Use only this encoding. By default the client's preference decides, and `gzip` wins a tie. */
    encoding?: "gzip" | "deflate";
};

// 圧縮が効く種類だけ(画像や zip は、すでに圧縮されている)
const COMPRESSIBLE = /^(?:text\/|image\/svg\+xml|application\/(?:json|javascript|xml|wasm|[\w.-]+\+(?:json|xml))(?:\s*;|\s*$))/i;
const ENCODINGS: readonly Encoding[] = ["gzip", "deflate"];

const encoder = new TextEncoder();

// Accept-Encoding で選ぶ。q=0 は「受け取らない」。名前がなければ * の値を使う
function chooseEncoding(header: string | null, allowed: readonly Encoding[]): Encoding | null {
    if (header === null) return null;
    const weights = new Map<string, number>();
    for (const part of header.split(",")) {
        const [name, ...params] = part.split(";");
        const q = params.map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param)).find(Boolean);
        // q を読めないものは受け取らないものとして扱う
        weights.set(name!.trim().toLowerCase(), params.length === 0 ? 1 : Number(q?.[1] ?? 0));
    }
    let best: Encoding | null = null;
    let bestWeight = 0;
    for (const encoding of allowed) {
        const weight = weights.get(encoding) ?? weights.get("*") ?? 0;
        if (weight > bestWeight) {
            best = encoding;
            bestWeight = weight;
        }
    }
    return best;
}

/**
 * Middleware that compresses response bodies with `gzip` or `deflate`, as chosen by the `Accept-Encoding` header, and adds
 * `Vary: Accept-Encoding` to responses that can be compressed. A strong `ETag` becomes weak when the body is compressed.
 *
 * It leaves these responses as they are:
 * - `HEAD`, 204, 206 and 304 responses, and bodies smaller than `threshold`
 * - Responses that already have `Content-Encoding`, or `Cache-Control: no-transform` on the `Response` itself
 *   (middleware cannot see headers set with `c.header()`)
 * - Types that do not compress well: only `text/*` (except `text/event-stream`), JSON, XML, JavaScript, SVG and WASM
 *   are compressed
 * - Streams without `Content-Length` that cannot be read within a few milliseconds. `CompressionStream` holds data
 *   back, so a stream that sends a little at a time would look stuck. This can delay the start of a stream by up to 5 ms
 *
 * Register it before `etag()`. Cloudflare usually compresses responses by itself, so you may not need it on Workers.
 *
 * Throws when `threshold` is not a number of 0 or more, or `encoding` is not `gzip` or `deflate`.
 *
 * @example
 * ```ts
 * import { compress, createApp } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use(compress());
 * app.get("/posts", () => listPosts());
 * ```
 */
export function compress(options: CompressOptions = {}): Middleware {
    const threshold = options.threshold ?? 1024;
    if (typeof threshold !== "number" || !(threshold >= 0)) throw senriError("compress_threshold", "compress(): invalid threshold");
    if (options.encoding !== undefined && !ENCODINGS.includes(options.encoding)) throw senriError("compress_encoding", "compress(): invalid encoding");
    const allowed = options.encoding ? [options.encoding] : ENCODINGS;

    return markPlainSafe<Middleware>(async function compress(c, next) {
        const method = methodOf(c);
        const res = await next();
        const { status } = res;
        if (method === "HEAD" || status < 200 || status === 204 || status === 205 || status === 206 || status === 304) return res;

        let source: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>;
        if (res instanceof PlainResponse) {
            // Node の近道: 小さければ、Headers も Response も作らずに終わる
            if (!COMPRESSIBLE.test(res.type) || res.type.toLowerCase().startsWith("text/event-stream")) return res;
            source = encoder.encode(res.body as unknown as string);
            if (source.length < threshold) return res;
        } else {
            const headers = res.headers;
            const type = headers.get("content-type");
            if (res.body === null || type === null || !COMPRESSIBLE.test(type) || type.toLowerCase().startsWith("text/event-stream")) return res;
            if (headers.has("content-encoding") || /(?:^|[\s,])no-transform(?:$|[\s,])/i.test(headers.get("cache-control") ?? "")) return res;
            // Content-Length があれば読まなくても分かる(serveStatic() など)。なければ少しだけ読む
            const length = headers.get("content-length");
            if (length !== null && Number(length) >= 0) {
                if (Number(length) < threshold) return res;
            } else if ((await peekBody(res, threshold - 1)) !== "large") {
                return res;
            }
            source = res.body;
        }

        // ここまで来たら、Accept-Encoding によって応答が変わる
        const editableRes = editable(res);
        appendVary(editableRes.headers, "Accept-Encoding");
        const encoding = chooseEncoding(headerOf(c, "accept-encoding"), allowed);
        if (encoding === null) return editableRes;

        const headers = new Headers(editableRes.headers);
        headers.set("content-encoding", encoding);
        headers.delete("content-length");
        // 圧縮すると中身のバイト列が変わるので、強い ETag のままにはできない
        const tag = headers.get("etag");
        if (tag !== null && !tag.startsWith("W/")) headers.set("etag", `W/${tag}`);
        const stream = source instanceof Uint8Array ? new Blob([source]).stream() : source;
        const body = (stream as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(new CompressionStream(encoding));
        // encodeBody: Workers に、もう圧縮してあることを伝える(ほかのランタイムは無視する)
        return new Response(body, { status, statusText: editableRes.statusText, headers, encodeBody: "manual" } as ResponseInit);
    });
}
