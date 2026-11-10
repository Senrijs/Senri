// アップロードされたファイルの大きさ、数、種類を確かめる
import type { FormBody } from "../body.ts";
import type { Context, Middleware } from "../context.ts";
import { HttpError, senriError } from "../errors.ts";
import { hasNoBody, headerOf, markPlainSafe } from "../plain.ts";
import { bodyLimit } from "./body-limit.ts";

/** Options for {@link uploadLimit}. */
export type UploadLimitOptions = {
    // 本文全体の上限。読む量はこれで決まるので必須
    /** The maximum size of the whole request body, in bytes. Required: `c.body()` holds the whole body in memory, so this is how much memory an upload can use. */
    maxTotalSize: number;
    /** The maximum size of each file, in bytes. */
    maxFileSize?: number;
    /** The maximum number of files. */
    maxFiles?: number;
    /** Accepted types, such as `"image/png"` or `"image/*"`. Note that `image/*` includes SVG, which can contain scripts. */
    types?: readonly string[];
    /** Accepted file name extensions, such as `".png"`. Case does not matter. */
    extensions?: readonly string[];
    // 種類が分かるものは、中身の先頭のバイトでも確かめる。false なら確かめない
    /** Compare the first bytes of PNG, JPEG, GIF, WebP and PDF files with the type they claim. Default `true`. */
    sniff?: boolean;
    /** Your own check for each file; only `true` accepts it. For example, to read the first bytes of other types. */
    check?: (file: File, c: Context) => boolean | Promise<boolean>;
};

// 種類ごとの、ファイルの先頭のバイト。null はどの値でもよい
const SIGNATURES: Record<string, (number | null)[]> = {
    "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/gif": [0x47, 0x49, 0x46, 0x38],
    // RIFF????WEBP
    "image/webp": [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
    "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
};

const mediaType = (value: string) => value.split(";", 1)[0]!.trim().toLowerCase();

async function matchesSignature(file: File, type: string): Promise<boolean> {
    const signature = SIGNATURES[type];
    if (!signature) return true;
    const head = new Uint8Array(await file.slice(0, signature.length).arrayBuffer());
    return signature.every((byte, i) => byte === null || head[i] === byte);
}

const tooLarge = () => new HttpError(413, "413 Content Too Large");
const unsupported = () => new HttpError(415, "415 Unsupported Media Type");

/**
 * Middleware that checks files uploaded as `multipart/form-data` before the handler runs: their sizes, number and types.
 * Over a limit it responds with 413, and for a type that is not accepted with 415, by throwing an `HttpError`. Other
 * requests pass through, so use `bodyLimit()` for those.
 *
 * - **Memory:** `c.body()` reads the whole body into memory, so `maxTotalSize` is required. It also limits bodies without
 *   `Content-Length`, while they are read
 * - **Reading the files:** use `await c.body()` in the handler. This middleware has read it already, and a schema on the route (`{ body: schema }`) sees the same `File` objects after these checks
 * - **Types can be faked:** `types` and `extensions` only compare what the client sent. `sniff` also reads the first bytes of
 *   five common types, and `check` can do the same for others. No check here makes a file safe to serve to browsers
 * - **On Bun**, `file.type` comes from the file name's extension, not from what the client sent, and is empty without an
 *   extension. So on Bun, `types` also judges by the name, and a file with no extension fails it
 * - **File names can be anything,** including `../../etc/passwd`. Do not build a path from `file.name`: choose your own
 *   name, such as `crypto.randomUUID()`, and keep the original only for display. {@link safeFileName} removes path parts if you do need it
 *
 * Throws when `maxTotalSize` is missing or an option is invalid.
 *
 * @example
 * ```ts
 * import { createApp, uploadLimit } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.use("/photos", uploadLimit({
 *     maxTotalSize: 20 * 1024 * 1024,
 *     maxFileSize: 5 * 1024 * 1024,
 *     maxFiles: 3,
 *     types: ["image/png", "image/jpeg"],
 * }));
 * app.post("/photos", async (_, c) => {
 *     const { photo } = await c.body<{ photo: File }>();
 *     await save(crypto.randomUUID(), photo);
 *     return { size: photo.size };
 * });
 * ```
 */
export function uploadLimit(options: UploadLimitOptions): Middleware {
    const { maxTotalSize, maxFileSize, maxFiles, types, extensions, check } = options;
    const limit = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
    const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
    const valid =
        limit(maxTotalSize) &&
        (maxFileSize === undefined || limit(maxFileSize)) &&
        (maxFiles === undefined || limit(maxFiles)) &&
        (types === undefined || strings(types)) &&
        (extensions === undefined || (strings(extensions) && extensions.every((extension) => extension.startsWith(".")))) &&
        (check === undefined || typeof check === "function");
    if (!valid) throw senriError("upload_limit_options", "uploadLimit(): invalid options");
    const accepted = types?.map((type) => type.toLowerCase());
    const endings = extensions?.map((extension) => extension.toLowerCase());
    const sniff = options.sniff ?? true;
    const total = bodyLimit({
        maxSize: maxTotalSize,
        onError: () => {
            throw tooLarge();
        },
    });

    const inspect = async (c: Context, file: File) => {
        if (maxFileSize !== undefined && file.size > maxFileSize) throw tooLarge();
        const type = mediaType(file.type);
        if (accepted && !accepted.some((item) => item === type || (item.endsWith("/*") && type.startsWith(item.slice(0, -1))))) throw unsupported();
        if (endings) {
            // Bun では、空のファイル名が null になる
            const name = (file.name ?? "").toLowerCase();
            if (!endings.some((ending) => name.endsWith(ending))) throw unsupported();
        }
        if (sniff && !(await matchesSignature(file, type))) throw unsupported();
        if (check && (await check(file, c)) !== true) throw unsupported();
    };

    return markPlainSafe<Middleware>(async function uploadLimit(c, next) {
        if (mediaType(headerOf(c, "content-type") ?? "") !== "multipart/form-data" || hasNoBody(c)) return next();

        // 読んでいる途中で上限を超えると、フォームの読み取りは 400 で失敗する。
        // ここで投げると bodyLimit が 413 に直せないので、いったん受け取って、bodyLimit に返したあとで投げる
        const failed = new Response(null);
        let failure: unknown;
        const result = await total(c, async () => {
            try {
                const form = await c.body<FormBody>();
                const files: File[] = [];
                for (const value of Object.values(form).flat()) {
                    // ブラウザは、ファイルを選んでいない欄を、名前のない空のファイルとして送る
                    if (value instanceof File && (value.name || value.size > 0)) files.push(value);
                }
                if (maxFiles !== undefined && files.length > maxFiles) throw tooLarge();
                for (const file of files) await inspect(c, file);
            } catch (err) {
                failure = err;
                return failed;
            }
            return next();
        });
        if (result === failed) throw failure;
        return result as Response;
    });
}

// Windows が特別に扱う名前(拡張子があっても)
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

/**
 * Removes what could make a file name reach outside a folder: directories, `..`, control characters and characters that
 * Windows does not allow. It returns `fallback` if nothing is left. Prefer a name you choose yourself, such as
 * `crypto.randomUUID()`: this keeps a name inside a folder, but does not stop one from replacing another file there.
 *
 * @param name The file name, such as `file.name`.
 * @param fallback The name to use when nothing is left. Default `"file"`.
 *
 * @example
 * ```ts
 * import { safeFileName } from "@senrijs/senri";
 *
 * safeFileName("../../etc/passwd"); // "passwd"
 * safeFileName("C:\\temp\\a.png"); // "a.png"
 * ```
 */
export function safeFileName(name: string, fallback: string = "file"): string {
    let safe = (name.split(/[\\/]/).pop() ?? "").replace(/[\x00-\x1f\x7f<>:"|?*]/g, "");
    // 先頭の . は隠しファイルと .. を、末尾の . と空白は Windows が無視する
    safe = trimEnd(safe.replace(/^[.\s]+/, ""));
    if (RESERVED.test(safe)) safe = `_${safe}`;
    // 多くのファイルシステムの上限。文字単位で切って、サロゲートを壊さない
    // 切ったところが . や空白で終わることがあるので、もう一度末尾を削る
    // 200 文字は、UTF-16 の単位で多くても 400。先に切っておけば、長い名前でも大きな配列を作らない
    safe = trimEnd(Array.from(safe.slice(0, 400)).slice(0, 200).join(""));
    return safe === "" ? fallback : safe;
}

// 1 文字ずつ見る(. と空白)。/[.\s]+$/ は、. や空白が長く続いて最後が別の文字のとき、
// 始まる位置ごとに読み直すので、時間が長さの 2 乗になる(10 万文字で 10 秒ほど)。後ろから見れば、長さに比例する
const TRAILING = /[.\s]/;

function trimEnd(s: string): string {
    let end = s.length;
    // \s にサロゲートペアの文字はないので、UTF-16 の単位で見てよい
    while (end > 0 && TRAILING.test(s[end - 1]!)) end--;
    return s.slice(0, end);
}
