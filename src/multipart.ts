/**
 * Reads a `multipart/form-data` request part by part, without holding the whole body in memory: {@link multipart}.
 * Large files can be passed on as a stream while they arrive.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { multipart } from "@senrijs/senri/multipart";
 *
 * const app = createApp();
 * app.post("/upload", async (_, c) => {
 *     for await (const part of multipart(c, { maxFileSize: 100 * 1024 * 1024 })) {
 *         if (part.filename !== undefined) await save(crypto.randomUUID(), part.stream);
 *         else console.log(part.name, await part.text());
 *     }
 *     return "ok";
 * });
 * ```
 *
 * @module
 */
// @senrijs/senri/multipart の入口
// 本体(c.body())は本文を全部メモリに読む。こちらは届いた分から1パーツずつ渡す
// Context のメソッドにしないのは、使わないアプリのバンドルに入れないため(streaming と同じ)
// Web 標準の ReadableStream / TextDecoder / Headers だけを使う(Node / Bun / Deno / Workers で同じに動く)
import type { Context } from "./context.ts";
import { errorCode, HttpError, senriError } from "./errors.ts";
import { releaseBodyCap } from "./body-cap.ts";

/** Limits for {@link multipart}. Over a limit, it fails with an `HttpError` 413. */
export type MultipartLimits = {
    /** The maximum number of parts, fields and files together. Default `100`. */
    maxParts?: number;
    /** The maximum size of each file (a part with a file name), in bytes. Default 10 MiB. */
    maxFileSize?: number;
    /** The maximum size of each field (a part without a file name), in bytes. Default 64 KiB. */
    maxFieldSize?: number;
    /** The maximum size of the headers of each part, in bytes. Also limits the text before the first part. Default 8 KiB. */
    maxHeaderSize?: number;
    /**
     * The maximum size of the whole body, in bytes. Default 100 MiB, or `maxFileSize` when that is larger.
     * It replaces the app's default body limit (`createApp({ maxBodySize })`) for this request.
     */
    maxTotalSize?: number;
};

/** One part of a `multipart/form-data` body, given by {@link multipart}. */
export type MultipartPart = {
    /** The field name, from `Content-Disposition`. */
    readonly name: string;
    /**
     * The file name as the client sent it, or `undefined` for a field. Browsers send `""` (with an empty body) for a file
     * input where no file was chosen. It can be anything, including `../../etc/passwd`:
     * do not build a path from it. Choose your own name, such as `crypto.randomUUID()`, or use `safeFileName()`.
     */
    readonly filename: string | undefined;
    /** The part's `Content-Type`, or `"text/plain"` when it has none (RFC 7578). It is what the client claims, not checked. */
    readonly contentType: string;
    /** All headers of the part. */
    readonly headers: Headers;
    /** The part's body. It can be read once, and only before the loop moves on to the next part. */
    readonly stream: ReadableStream<Uint8Array>;
    /** Reads the whole part as UTF-8 text. */
    text(): Promise<string>;
    /** Reads the whole part as bytes. */
    bytes(): Promise<Uint8Array>;
};

const KIB = 1024;
const DEFAULTS: Required<MultipartLimits> = {
    maxParts: 100,
    maxFileSize: 10 * KIB * KIB,
    maxFieldSize: 64 * KIB,
    maxHeaderSize: 8 * KIB,
    maxTotalSize: 100 * KIB * KIB,
};

const encoder = new TextEncoder();
const CRLF = encoder.encode("\r\n");
const HEADER_END = encoder.encode("\r\n\r\n");
const DASH = 0x2d;

const malformed = () => new HttpError(400, "400 Bad Request: Invalid multipart body");
const tooLarge = () => new HttpError(413, "413 Content Too Large");
const skippedError = () => senriError("multipart_part_skipped", "multipart(): this part was skipped. Read each part before the loop moves on");

function limitsOf(limits: MultipartLimits): Required<MultipartLimits> {
    if (typeof limits !== "object" || limits === null) throw senriError("multipart_limits", "multipart(): invalid limits");
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof MultipartLimits)[]) {
        const value = limits[key];
        if (value === undefined) continue;
        if (typeof value !== "number" || !(value >= 0)) throw senriError("multipart_limits", "multipart(): invalid limits");
        out[key] = value;
    }
    // maxFileSize を既定の合計より大きくして maxTotalSize を書いていなければ、合計も maxFileSize に合わせる
    // (1 つのファイルの上限を上げたのに、合計の既定で止まらないように)
    if (limits.maxTotalSize === undefined && out.maxFileSize > out.maxTotalSize) out.maxTotalSize = out.maxFileSize;
    return out;
}

// Content-Type から boundary を取り出す。multipart/form-data でなければ 415、boundary がおかしければ 400
function boundaryOf(contentType: string | null): string {
    const [type = "", ...params] = (contentType ?? "").split(";");
    if (type.trim().toLowerCase() !== "multipart/form-data") throw new HttpError(415, "415 Unsupported Media Type");
    for (const param of params) {
        const eq = param.indexOf("=");
        if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== "boundary") continue;
        let value = param.slice(eq + 1).trim();
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        // RFC 2046: 1〜70 文字、使える文字が決まっていて、空白で終わらない
        if (/^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/.test(value)) return value;
        break;
    }
    throw malformed();
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
    const last = haystack.length - needle.length;
    for (let i = haystack.indexOf(needle[0]!, from); i !== -1 && i <= last; i = haystack.indexOf(needle[0]!, i + 1)) {
        let j = 1;
        while (j < needle.length && haystack[i + j] === needle[j]) j++;
        if (j === needle.length) return i;
    }
    return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}

// ヘッダーのバイト列は、1バイト1文字の文字列にする(Headers に入れられる)。名前とファイル名は、あとで UTF-8 として読み直す
const latin1 = (bytes: Uint8Array) => {
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return text;
};
// ブラウザはファイル名を UTF-8 のまま送る
const utf8 = (text: string) => new TextDecoder().decode(Uint8Array.from(text, (ch) => ch.charCodeAt(0)));

// Content-Disposition: form-data; name="a"; filename="b.txt"
// 引用符の中の \" と \\ だけはエスケープとして扱う(ブラウザは " を %22 にするので、ほかの \ はそのまま)
function dispositionOf(value: string): Map<string, string> | null {
    const semi = value.indexOf(";");
    if ((semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase() !== "form-data") return null;
    const params = new Map<string, string>();
    let i = semi === -1 ? value.length : semi + 1;
    while (i < value.length) {
        const eq = value.indexOf("=", i);
        if (eq === -1) break;
        const key = value.slice(i, eq).trim().toLowerCase();
        i = eq + 1;
        while (value[i] === " " || value[i] === "\t") i++;
        let text = "";
        const end = () => {
            const at = value.indexOf(";", i);
            return at === -1 ? value.length : at;
        };
        if (value[i] === '"') {
            for (i++; i < value.length && value[i] !== '"'; i++) {
                if (value[i] === "\\" && (value[i + 1] === '"' || value[i + 1] === "\\")) i++;
                text += value[i];
            }
            if (value[i] !== '"') return null;
            i = end() + 1;
        } else {
            const at = end();
            text = value.slice(i, at).trim();
            i = at + 1;
        }
        if (key !== "" && !params.has(key)) params.set(key, text);
    }
    return params;
}

// filename*=UTF-8''%E3%81%82.txt(RFC 5987)。UTF-8 以外や壊れた値なら undefined
function extendedValue(value: string | undefined): string | undefined {
    const match = value === undefined ? null : /^utf-8'[^']*'(.*)$/i.exec(value);
    if (!match) return undefined;
    try {
        return decodeURIComponent(match[1]!);
    } catch {
        return undefined;
    }
}

/**
 * Reads a `multipart/form-data` request part by part, holding only a small piece of the body in memory at a time.
 * Use it with `for await`; each part's `stream` can be passed on (to a file, to object storage) while it arrives.
 * Where to save is up to you.
 *
 * - **Read each part before the next one:** when the loop moves on, the rest of the part is skipped, and reading its
 *   `stream` afterwards fails. Await the save of a file before the loop continues
 * - **Limits** (see {@link MultipartLimits}) answer 413 by throwing an `HttpError`, from the loop or from a part's
 *   `stream`. A body that is not valid `multipart/form-data` gets 400, and another `Content-Type` gets 415
 * - **Once per request:** it throws when the body has already been read, for example by `c.body()` or `uploadLimit()`.
 *   Do not use `uploadLimit()` on the same route: it reads the whole body into memory to check the files
 * - **File names and types are what the client sent.** Do not build a path from `part.filename` (see `safeFileName()`),
 *   and do not trust `part.contentType`
 * - Leaving the loop early (`break`, or an error) stops reading the body
 *
 * Throws when a limit is not a number of 0 or more.
 *
 * @param c The context.
 * @param limits Limits on the number of parts and their sizes.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { multipart } from "@senrijs/senri/multipart";
 *
 * const app = createApp();
 * app.post("/upload", async (_, c) => {
 *     const fields: Record<string, string> = {};
 *     for await (const part of multipart(c, { maxFileSize: 100 * 1024 * 1024 })) {
 *         if (part.filename !== undefined) await bucket.put(crypto.randomUUID(), part.stream);
 *         else fields[part.name] = await part.text();
 *     }
 *     return fields;
 * });
 * ```
 */
export function multipart(c: Context, limits: MultipartLimits = {}): AsyncIterableIterator<MultipartPart> {
    const max = limitsOf(limits);
    // アプリの既定の上限(createApp({ maxBodySize }))を、multipart() の上限(maxTotalSize など)で置き換える
    releaseBodyCap(c);
    const req = c.req;
    if (req.bodyUsed || req.body?.locked) {
        throw senriError("multipart_body_used", "multipart(): the request body has already been read");
    }
    const boundary = boundaryOf(req.headers.get("content-type"));
    if (req.body === null) throw malformed();
    return parse(req.body.getReader(), boundary, max);
}

async function* parse(reader: ReadableStreamDefaultReader<Uint8Array>, boundary: string, max: Required<MultipartLimits>): AsyncGenerator<MultipartPart, void, undefined> {
    // 区切りは "\r\n--boundary"。最初の区切りだけ前に改行がないので、本文の前に改行を足して同じように探す
    const delimiter = encoder.encode(`\r\n--${boundary}`);
    let buf: Uint8Array = CRLF;
    let total = 0;
    // 一度失敗したら、どこから読んでも同じエラーにする
    let failure: unknown;
    let finished = false;

    // 読み足す。本文が終わっていたら false
    const fill = async (): Promise<boolean> => {
        const { done, value } = await reader.read();
        if (done) return false;
        total += value.byteLength;
        if (total > max.maxTotalSize) throw tooLarge();
        buf = buf.length === 0 ? value : concat(buf, value);
        return true;
    };
    // buf に n バイト以上ためる。本文が先に終わったら壊れている
    const need = async (n: number) => {
        while (buf.length < n) if (!(await fill())) throw malformed();
    };

    // パーツの本文を読む。区切りに着いたら end: true(chunk は区切りの手前までで、空のこともある)
    // 区切りの途中で切れているかもしれないので、末尾の(区切りの長さ - 1)バイトは次まで残す
    const keep = delimiter.length - 1;
    const readBody = async (): Promise<BodyChunk> => {
        for (;;) {
            const at = indexOf(buf, delimiter);
            if (at !== -1) {
                const chunk = buf.subarray(0, at);
                buf = buf.subarray(at + delimiter.length);
                return { chunk, end: true };
            }
            if (buf.length > keep) {
                const chunk = buf.subarray(0, buf.length - keep);
                buf = buf.subarray(buf.length - keep);
                return { chunk, end: false };
            }
            if (!(await fill())) throw malformed();
        }
    };

    // パーツの本文を読む処理は、同時に2つ走らないよう1列に並べる(ループが次へ進むときの読み飛ばしと、stream の読み取り)
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(run: () => Promise<T>): Promise<T> => {
        const next = queue.then(() => {
            if (failure !== undefined) throw failure;
            return run();
        });
        queue = next.catch(() => {});
        return next.catch((err) => {
            // 読み飛ばしたパーツを読もうとしただけなら、ほかのパーツには響かせない
            if (errorCode(err) === "multipart_part_skipped") throw err;
            failure ??= err;
            throw failure;
        });
    };

    try {
        // 最初の区切りまで(前置き)を読み飛ばす。前置きは maxHeaderSize まで(先頭に足した改行の分は数えない)
        let preamble = -CRLF.length;
        for (;;) {
            const at = indexOf(buf, delimiter);
            if (preamble + (at === -1 ? buf.length - keep : at) > max.maxHeaderSize) throw malformed();
            if (at !== -1) {
                buf = buf.subarray(at + delimiter.length);
                break;
            }
            if (buf.length > keep) {
                preamble += buf.length - keep;
                buf = buf.subarray(buf.length - keep);
            }
            if (!(await fill())) throw malformed();
        }

        for (let count = 0; ; ) {
            // 区切りのあとが "--" なら終わり。そうでなければ空白を許して、改行が続く
            await need(2);
            if (buf[0] === DASH && buf[1] === DASH) break;
            let pad = 0;
            for (;;) {
                await need(pad + 2);
                if (buf[pad] === 0x20 || buf[pad] === 0x09) {
                    if (++pad > max.maxHeaderSize) throw malformed();
                    continue;
                }
                if (buf[pad] !== 0x0d || buf[pad + 1] !== 0x0a) throw malformed();
                break;
            }
            // 改行は残して、"\r\n" + ヘッダー + "\r\n\r\n" として探す(ヘッダーが1行もないときも同じに扱える)
            buf = buf.subarray(pad);
            let end: number;
            while ((end = indexOf(buf, HEADER_END)) === -1) {
                // 前の改行 + 上限ちょうどのヘッダー + 途中まで届いた終わりの改行(3バイト)までは、まだ上限の内側
                if (buf.length > CRLF.length + max.maxHeaderSize + HEADER_END.length - 1) throw tooLarge();
                if (!(await fill())) throw malformed();
            }
            if (end - CRLF.length > max.maxHeaderSize) throw tooLarge();
            const raw = latin1(buf.subarray(CRLF.length, Math.max(end, CRLF.length)));
            buf = buf.subarray(end + HEADER_END.length);

            const headers = new Headers();
            for (const line of raw === "" ? [] : raw.split("\r\n")) {
                const colon = line.indexOf(":");
                if (colon <= 0) throw malformed();
                try {
                    headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
                } catch {
                    throw malformed();
                }
            }
            const params = dispositionOf(headers.get("content-disposition") ?? "");
            const name = params?.get("name");
            if (params === null || name === undefined) throw malformed();
            const plain = params.get("filename");
            const filename = extendedValue(params.get("filename*")) ?? (plain === undefined ? undefined : utf8(plain));
            if (++count > max.maxParts) throw tooLarge();

            const part = new Part(utf8(name), filename, headers, filename === undefined ? max.maxFieldSize : max.maxFileSize, readBody, serial);
            yield part;
            // ループが次へ進んだ。読み残しを読み飛ばす(上限は数え続ける)
            await part.skip();
        }

        // 終わりの区切りのあと(後書き)は読み捨てる。読まずに切ると、Node では接続ごと閉じてしまうため
        // 長すぎるときだけ、読むのをやめる(finally で切る)
        let rest = buf.length;
        buf = new Uint8Array(0);
        while (rest <= max.maxHeaderSize && (await fill())) {
            rest += buf.length;
            buf = new Uint8Array(0);
        }
        finished = rest <= max.maxHeaderSize;
    } catch (err) {
        failure ??= err;
        throw failure;
    } finally {
        // 途中で抜けた(break やエラー)なら、それ以上は読まない
        if (!finished) reader.cancel(failure).catch(() => {});
        // ループを抜けたあとに、最後のパーツの stream を読んだときのエラー
        failure ??= skippedError();
    }
}

type BodyChunk = { chunk: Uint8Array; end: boolean };

class Part implements MultipartPart {
    readonly name: string;
    readonly filename: string | undefined;
    readonly contentType: string;
    readonly headers: Headers;
    #stream: ReadableStream<Uint8Array> | undefined;
    #size = 0;
    #done = false;
    #skipped = false;
    #max: number;
    #read: () => Promise<BodyChunk>;
    #serial: <T>(run: () => Promise<T>) => Promise<T>;

    constructor(name: string, filename: string | undefined, headers: Headers, max: number, read: () => Promise<BodyChunk>, serial: <T>(run: () => Promise<T>) => Promise<T>) {
        this.name = name;
        this.filename = filename;
        this.headers = headers;
        this.contentType = headers.get("content-type") ?? "text/plain";
        this.#max = max;
        this.#read = read;
        this.#serial = serial;
    }

    // 次のチャンク。終わりなら null。パーツの上限もここで数える
    #next(): Promise<Uint8Array | null> {
        return this.#serial(async () => {
            if (this.#skipped) throw skippedError();
            while (!this.#done) {
                const { chunk, end } = await this.#read();
                if (end) this.#done = true;
                if (chunk.length === 0) continue;
                this.#size += chunk.length;
                if (this.#size > this.#max) throw tooLarge();
                return chunk;
            }
            return null;
        });
    }

    get stream(): ReadableStream<Uint8Array> {
        // 読まれた分だけ本文を読む(highWaterMark 0。先に読みためない)
        this.#stream ??= new ReadableStream<Uint8Array>(
            {
                pull: async (controller) => {
                    const chunk = await this.#next();
                    if (chunk === null) controller.close();
                    else controller.enqueue(chunk);
                },
            },
            { highWaterMark: 0 },
        );
        return this.#stream;
    }

    async bytes(): Promise<Uint8Array> {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = this.stream.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            size += value.length;
        }
        const out = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }

    async text(): Promise<string> {
        return new TextDecoder().decode(await this.bytes());
    }

    // 読み残しを読み捨てる。そのあと stream を読むとエラーにする
    async skip(): Promise<void> {
        while ((await this.#next()) !== null);
        this.#skipped = true;
    }
}
