// リクエストごとに ID を付ける(ログや、別のサービスとの突き合わせに使う)
import type { Context, Middleware } from "../context.ts";
import { senriError } from "../errors.ts";
import { headerOf, markPlainSafe } from "../plain.ts";

/** Options for {@link requestId}. */
export type RequestIdOptions = {
    // 受け取った ID を使うか。前段のプロキシが付けた ID を引き継ぐときだけ true にする(クライアントも好きな値を送れる)
    /**
     * Use the ID sent by the client or a proxy, if it is safe. Default `false`: anyone can send this header, so enable
     * it only when a proxy you trust sets it. Up to 128 characters of `A-Z a-z 0-9 . _ = + / -` are accepted;
     * anything else is discarded and a new ID is generated.
     */
    trustIncoming?: boolean;
    /** The request and response header. Default `"X-Request-Id"`. */
    headerName?: string;
    // ID を作る関数。ここで作った値は確かめない(アプリ自身のコードなので)
    /** Generates an ID. Default `crypto.randomUUID()`. The value is not checked, so it must be a valid header value. */
    generator?: (c: Context) => string;
};

/**
 * The variables set by {@link requestId}, for typing `c.get`.
 *
 * @example
 * ```ts
 * const app = createApp<RequestIdVariables>();
 * app.use(requestId());
 * app.get("/", (_, c) => c.get("requestId")); // string | undefined
 * ```
 */
export type RequestIdVariables = {
    /** The ID of this request. */
    requestId: string;
};

// ログに混ぜても安全な文字だけ(改行、空白、引用符、制御文字などを通さない)
const SAFE_ID = /^[A-Za-z0-9._=+/-]{1,128}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Middleware that gives each request an ID. Read it with `c.get("requestId")`; it is also sent in the `X-Request-Id`
 * response header, including on error responses.
 *
 * Throws when `headerName` is not a valid header name.
 *
 * @example
 * ```ts
 * import { createApp, requestId, type RequestIdVariables } from "@senrijs/senri";
 *
 * const app = createApp<RequestIdVariables>();
 * app.use(requestId());
 * app.get("/", (_, c) => `Your request: ${c.get("requestId")}`);
 *
 * // Behind a proxy you trust that sets the header:
 * // app.use(requestId({ trustIncoming: true }));
 * ```
 */
export function requestId(options: RequestIdOptions = {}): Middleware {
    const headerName = (options.headerName ?? "X-Request-Id").toLowerCase();
    if (!HEADER_NAME.test(headerName)) throw senriError("request_id_header", "requestId(): invalid headerName");
    const generate = options.generator ?? (() => crypto.randomUUID());

    return markPlainSafe<Middleware>(async function requestId(c, next) {
        const incoming = options.trustIncoming ? headerOf(c, headerName) : null;
        const id = incoming !== null && SAFE_ID.test(incoming) ? incoming : generate(c);
        c.set("requestId", id);
        // c.header() なら、エラーのレスポンスにも付く
        c.header(headerName, id);
        return next();
    });
}
