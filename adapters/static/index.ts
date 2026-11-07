/**
 * Static file middleware for Bun, Deno and Node.js (uses `node:fs`).
 * Not available on Cloudflare Workers; use Workers Static Assets there.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { serveStatic } from "@senrijs/senri/static";
 *
 * const app = createApp();
 * app.use(serveStatic({ root: "./public" }));
 * ```
 *
 * @module
 */
// 静的ファイル配信(senri/static)。node:fs を使うので本体とは別の入口にしている
// Bun / Deno / Node で動く。Cloudflare Workers ではファイルを読めないので、wrangler の Static Assets を使う
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import type { Middleware } from "../../src/index.ts";
import { matchesEtag } from "../../src/middleware/response.ts";
import { headerOf, markPlainSafe, methodOf } from "../../src/plain.ts";
import { middlewarePath, splitPattern } from "../../src/router.ts";

/** Options for {@link serveStatic}. */
export type ServeStaticOptions = {
    // 配るディレクトリ。相対パスなら、serveStatic() を呼んだときのカレントディレクトリから
    /** The directory to serve. A relative path is resolved from the current directory when `serveStatic()` is called. */
    root: string;
    // このパスの下だけで配る。"/static" なら /static/app.js → root/app.js
    /**
     * Serve only under this URL path: with `"/static"`, `/static/app.js` serves `root/app.js`. Default `"/"`.
     * `"/static/*"` means the same as `"/static"`, as in `app.use`. Any other `*` throws.
     */
    prefix?: string;
    // ディレクトリを開いたときに返すファイル。false なら返さない
    /** The file served for a directory. Default `"index.html"`; `false` disables it. */
    index?: string | false;
    // "." で始まるファイルやディレクトリ(.env や .git)を配るか。既定は配らない
    /** Serve files and directories whose names start with `.` (such as `.env` or `.git`). Default `false`. */
    dotfiles?: boolean;
    // Cache-Control ヘッダー
    /** The `Cache-Control` header value. Not set by default. */
    cacheControl?: string;
};

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xml": "application/xml",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".zip": "application/zip",
    ".webmanifest": "application/manifest+json",
};

function isWorkers(): boolean {
    return (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === "Cloudflare-Workers";
}

// ファイルの場所として使ってはいけないセグメント
// (ルーターが "." / ".." / %2F は 400 にしている。ここでは Windows の区切りやドライブ、NUL を防ぐ)
function unsafeSegment(segment: string): boolean {
    return segment.includes("\\") || segment.includes(":") || segment.includes("\0");
}

// Windows(NTFS)と macOS(APFS)は、違う綴りでも同じファイルを開く(大文字小文字、8.3 の短い名前、Deno では末尾の . や空白)
// app.use("/admin", ...) は綴りどおりにしか当たらないので、"/ADMIN/..." でミドルウェアを飛ばして配れてしまう
// なので、この2つでは、各セグメントがディスク上の名前と完全に同じかを readdir で確かめる(realpath の挙動には頼らない)
// Linux は綴りが違えば別のファイルなので、確かめない
const LOOSE_NAMES = process.platform === "win32" || process.platform === "darwin";

// dir の中に、name がその綴りのままあるか。一覧は毎回読む
// (ディレクトリの mtime で使い回すと、同じ時計の刻みのうちに続けて名前を変えたとき mtime が変わらず、古い一覧が残る)
async function hasExactName(dir: string, name: string): Promise<boolean> {
    const names = await readdir(dir).catch(() => null);
    return names !== null && names.includes(name);
}

/**
 * Middleware that serves files from a directory for GET and HEAD. When there is no matching file, it calls `next()`.
 * - Never serves files outside `root`, including through symbolic links. This assumes that people you do not
 *   trust cannot change the contents of `root` (files and links are checked before they are read)
 * - Sends a weak `ETag` and `Last-Modified`, and answers 304 to `If-None-Match` / `If-Modified-Since`
 * - `Content-Type` comes from the file extension (`application/octet-stream` if unknown)
 * - On Windows and macOS, a path must spell each name exactly as on disk (case, short 8.3 names and trailing dots
 *   do not match). On macOS, write names with two Unicode forms (NFC / NFD, such as Japanese) in the form they are
 *   stored in. To check this, it reads the directory listings on every request there, so large static directories
 *   are better served on Linux or from a CDN. Even so, keep files that need protection outside `root` rather than
 *   guarding part of `root` with `app.use(path, ...)`
 *
 * Throws on Cloudflare Workers, which cannot read files; use Workers Static Assets there.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { serveStatic } from "@senrijs/senri/static";
 *
 * const app = createApp();
 * app.use(serveStatic({ root: "./public", prefix: "/static", cacheControl: "public, max-age=3600" }));
 * ```
 */
export function serveStatic(options: ServeStaticOptions): Middleware {
    if (isWorkers()) {
        throw new Error(
            "serveStatic() cannot be used on Cloudflare Workers (it cannot read files).\n" +
                "Serve files with assets (Static Assets) in wrangler.jsonc: https://developers.cloudflare.com/workers/static-assets/",
        );
    }
    const root = resolve(options.root);
    // app.use("/x/*") と同じく、末尾の "/*" は取り、ほかの * はエラーにする(文字のまま比べると、何も配らない)
    const prefix = splitPattern(middlewarePath(options.prefix ?? "/"));
    const index = options.index ?? "index.html";
    // シンボリックリンクで外に出ていないかを、実体のパスで確かめる(root 自体がリンクでもよいように、root も実体にする)
    const realRoot = realpath(root).catch(() => root);

    return markPlainSafe<Middleware>(async function serveStatic(c, next) {
        const method = methodOf(c);
        if (method !== "GET" && method !== "HEAD") return next();

        const segments = c.segments;
        if (segments.length < prefix.length || prefix.some((p, i) => p !== segments[i])) return next();
        const rest = segments.slice(prefix.length);
        if (rest.some(unsafeSegment)) return next();
        if (!options.dotfiles && rest.some((s) => s.startsWith("."))) return next();

        let file = join(root, ...rest);
        // 念のため、つないだ結果が root の外になっていないか
        const rel = relative(root, file);
        if (rel.startsWith("..") || resolve(root, rel) !== file) return next();

        let names = rest;
        let info = await stat(file).catch(() => null);
        if (info?.isDirectory()) {
            if (index === false) return next();
            file = join(file, index);
            names = [...rest, ...index.split("/").filter(Boolean)];
            info = await stat(file).catch(() => null);
        }
        if (!info?.isFile()) return next();

        const real = await realpath(file).catch(() => null);
        const base = await realRoot;
        if (real === null || (real !== base && !real.startsWith(base.endsWith(sep) ? base : base + sep))) return next();
        // root の中のシンボリックリンクが .env などを指していることもあるので、実体のパスでもドットファイルを確かめる
        if (!options.dotfiles && relative(base, real).split(sep).some((s) => s.startsWith("."))) return next();
        if (LOOSE_NAMES) {
            for (let i = 0; i < names.length; i++) {
                if (!(await hasExactName(join(root, ...names.slice(0, i)), names[i]!))) return next();
            }
        }

        const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
        const lastModified = info.mtime.toUTCString();
        const headers = new Headers({ etag, "last-modified": lastModified });
        if (options.cacheControl) headers.set("cache-control", options.cacheControl);

        // 変わっていなければ 304(If-None-Match があれば、If-Modified-Since より優先する)
        const ifNoneMatch = headerOf(c, "if-none-match");
        const ifModifiedSince = headerOf(c, "if-modified-since");
        const notModified =
            ifNoneMatch !== null
                ? matchesEtag(ifNoneMatch, etag)
                : ifModifiedSince !== null && Math.floor(info.mtimeMs / 1000) <= Date.parse(ifModifiedSince) / 1000;
        if (notModified) return new Response(null, { status: 304, headers });

        headers.set("content-type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
        headers.set("content-length", String(info.size));
        if (method === "HEAD") return new Response(null, { status: 200, headers });

        const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
        return new Response(body, { status: 200, headers });
    });
}
