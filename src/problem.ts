/**
 * Error responses in the Problem Details format (RFC 9457, `application/problem+json`). Opt-in: nothing changes
 * until you use it, and the default error responses stay plain text.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { ProblemError, problemDetails } from "@senrijs/senri/problem";
 *
 * const app = createApp();
 * const problems = problemDetails();
 * app.onError(problems.onError);
 * app.notFound(problems.notFound);
 *
 * app.post("/transfer", () => {
 *     throw new ProblemError(403, {
 *         type: "https://example.com/probs/out-of-credit",
 *         title: "You do not have enough credit.",
 *         detail: "Your current balance is 30, but that costs 50.",
 *         extensions: { balance: 30 },
 *     });
 * });
 * ```
 *
 * @module
 */
// Problem Details(RFC 9457)の形のエラーレスポンス。使う人が選んだときだけ使う(既定のエラーの形は変えない)
// 本体を太らせないよう、別の入口(@senrijs/senri/problem)にしている
import type { Context } from "./context.ts";
import { type ErrorHandler, HttpError, type NotFoundHandler } from "./errors.ts";
import { ValidationError } from "./validate.ts";

/** The members of a problem details object (RFC 9457). Any other members are extensions. */
export type ProblemDetails = {
    // 問題の種類を表す URI。既定は "about:blank"(HTTP の status のほかに説明がない)
    /** A URI that identifies the problem type. Default `"about:blank"` (the status says it all). */
    type?: string;
    // 短い説明。type が "about:blank" のときは、status の名前("Not Found" など)
    /** A short summary of the problem type. For `"about:blank"`, the status name (such as `"Not Found"`). */
    title?: string;
    /** The HTTP status code. */
    status?: number;
    /** An explanation of this occurrence of the problem, for the client. */
    detail?: string;
    /** A URI that identifies this occurrence of the problem. */
    instance?: string;
    /** Extension members. */
    [extension: string]: unknown;
};

// RFC 9110 などの status の名前。type が about:blank のときの title に使う
const TITLES: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    406: "Not Acceptable",
    407: "Proxy Authentication Required",
    408: "Request Timeout",
    409: "Conflict",
    410: "Gone",
    411: "Length Required",
    412: "Precondition Failed",
    413: "Content Too Large",
    414: "URI Too Long",
    415: "Unsupported Media Type",
    416: "Range Not Satisfiable",
    417: "Expectation Failed",
    421: "Misdirected Request",
    422: "Unprocessable Content",
    423: "Locked",
    424: "Failed Dependency",
    425: "Too Early",
    426: "Upgrade Required",
    428: "Precondition Required",
    429: "Too Many Requests",
    431: "Request Header Fields Too Large",
    451: "Unavailable For Legal Reasons",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
    505: "HTTP Version Not Supported",
    506: "Variant Also Negotiates",
    507: "Insufficient Storage",
    508: "Loop Detected",
    511: "Network Authentication Required",
};

const CONTENT_TYPE = "application/problem+json";

// RFC 9457 で決まっているメンバー。extensions でこれらを上書きさせない
const MEMBERS = ["type", "title", "status", "detail", "instance"];

/**
 * An {@link HttpError} that carries problem details. With {@link problemDetails}'s `onError`, the response is
 * `application/problem+json` with these members. With any other `onError`, it acts as an `HttpError` whose message is
 * `detail` (or `title`, or the status name), so the default handler sends that message as text.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { ProblemError } from "@senrijs/senri/problem";
 *
 * const app = createApp();
 * app.get("/orders/:id", ({ id }) => {
 *     throw new ProblemError(409, { title: "Order already shipped", detail: `Order ${id} cannot be changed.` });
 * });
 * ```
 */
export class ProblemError extends HttpError {
    /** The problem details, without `status` (that is {@link HttpError.status}). */
    readonly details: ProblemDetails;

    /**
     * Creates an error with problem details.
     *
     * @param status The HTTP status code.
     * @param details `type`, `title`, `detail`, `instance`, and `extensions` (other members, such as `{ balance: 30 }`).
     * @param options `headers` to add to the response, and the `cause`.
     */
    constructor(
        status: number,
        details: {
            type?: string;
            title?: string;
            detail?: string;
            instance?: string;
            extensions?: Record<string, unknown>;
        } = {},
        options: { headers?: HeadersInit; cause?: unknown } = {},
    ) {
        super(status, details.detail ?? details.title ?? titleOf(status), options);
        this.name = "ProblemError";
        const { extensions, ...members } = details;
        this.details = { ...withoutMembers(extensions), ...members };
    }
}

function titleOf(status: number): string {
    return TITLES[status] ?? `HTTP ${status}`;
}

function withoutMembers(extensions: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (extensions) for (const [key, value] of Object.entries(extensions)) if (!MEMBERS.includes(key)) out[key] = value;
    return out;
}

/**
 * Builds an `application/problem+json` response. `status` defaults to the status set with `c.status()`;
 * with `type` left out (`"about:blank"`), `title` defaults to the status name. Headers set with `c.header()` are added
 * as usual.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { problem } from "@senrijs/senri/problem";
 *
 * const app = createApp();
 * app.get("/legacy", (_, c) => problem(c, { status: 410, detail: "Use /v2 instead." }));
 * ```
 */
export function problem(c: Context, details: ProblemDetails = {}): Response {
    const status = details.status ?? statusOf(c);
    const body: ProblemDetails = { type: details.type ?? "about:blank" };
    // about:blank のときの title は status の名前(RFC 9457 4.2.1)。ほかの type で title がなければ付けない
    const title = details.title ?? (details.type === undefined || details.type === "about:blank" ? titleOf(status) : undefined);
    if (title !== undefined) body.title = title;
    body.status = status;
    if (details.detail !== undefined) body.detail = details.detail;
    if (details.instance !== undefined) body.instance = details.instance;
    for (const [key, value] of Object.entries(details)) {
        if (!MEMBERS.includes(key) && value !== undefined) body[key] = value;
    }
    return new Response(JSON.stringify(body), { status, headers: { "content-type": CONTENT_TYPE } });
}

// c.status() で決めた status(Context は値を外に見せないので、空のレスポンスから読む)
function statusOf(c: Context): number {
    return c.text("").status;
}

/** Options for {@link problemDetails}. */
export type ProblemDetailsOptions = {
    // バリデーションに通らなかったとき(ValidationError)に、どこが違うかを errors として返すか
    /**
     * For a {@link ValidationError}, add an `errors` member listing the issues
     * (`{ in: "query", path: ["page"], message: "..." }`). Default `false`, as the default error handler does not show
     * them either: they reveal how your schemas are built.
     */
    validationErrors?: boolean;
};

/**
 * Error and not-found handlers that answer in the Problem Details format (RFC 9457). Set them with `app.onError`
 * and `app.notFound`; nothing changes until you do.
 * - {@link ProblemError}: its members
 * - Other {@link HttpError}s (such as 405 from the router, 401 from `basicAuth()` or 429 from `rateLimit()`):
 *   `title` is the status name, and `detail` is the message unless it is just the status (`"405 Method Not Allowed"`).
 *   The error's headers (`Allow`, `WWW-Authenticate`, `Retry-After`) are kept
 * - Anything else: 500 with `title` only; the error's message is not sent, as with the default handler
 * - Requests that match no route, and `c.notFound()`: 404
 *
 * Like any handler set with `app.onError` / `app.notFound`, these also replace the development error page, 404 page and
 * detailed messages in development mode. To keep them while developing, set these only in production.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { problemDetails } from "@senrijs/senri/problem";
 *
 * const app = createApp();
 * const problems = problemDetails({ validationErrors: true });
 * app.onError(problems.onError);
 * app.notFound(problems.notFound);
 * ```
 */
export function problemDetails(options: ProblemDetailsOptions = {}): { onError: ErrorHandler; notFound: NotFoundHandler } {
    return {
        onError: (err, c) => {
            if (err instanceof ProblemError) return problem(c, { ...err.details, status: err.status });
            if (!(err instanceof HttpError)) return problem(c, { status: 500 });
            const details: ProblemDetails = { status: err.status, detail: detailOf(err) };
            if (options.validationErrors && err instanceof ValidationError) {
                details.errors = err.issues.map((issue) => ({
                    in: err.target,
                    path: (issue.path ?? []).map((p) => {
                        const key = typeof p === "object" && p !== null ? p.key : p;
                        return typeof key === "symbol" ? String(key) : key;
                    }),
                    message: issue.message,
                }));
            }
            return problem(c, details);
        },
        notFound: (c) => problem(c, { status: 404 }),
    };
}

// Senri の HttpError の message は "405 Method Not Allowed" や "400 Bad Request: Invalid JSON" の形
// status と名前だけなら detail にしない(title と同じことしか言っていない)。": " の後ろがあれば、そこを detail にする
function detailOf(err: HttpError): string | undefined {
    const statusLine = `${err.status} ${titleOf(err.status)}`;
    const message = err.message;
    if (message === statusLine || message === `HTTP ${err.status}` || message === "") return undefined;
    if (message.startsWith(`${statusLine}: `)) return message.slice(statusLine.length + 2);
    return message;
}
