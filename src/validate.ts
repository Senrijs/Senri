// Standard Schema(https://standardschema.dev)によるバリデーション
// Zod・Valibot・ArkType など、Standard Schema に対応したライブラリのスキーマをそのまま使える(Senri はどれにも依存しない)
//
// app.post("/users/:id", { params, query, body }, handler) のように、ルートにスキーマを渡す
// - params: パスパラメーター。通ればハンドラーの第1引数(と c.params)が変換後の値になる
// - query: c.query() の結果。通れば c.valid("query") で読める
// - body: c.body() の結果(Content-Type に合わせて読んだもの)。通れば c.valid("body") で読める
// どれかが通らなければ、ハンドラーは呼ばずに 400 にする(ValidationError)
import { setValidated, type Context, type Handler } from "./context.ts";
import { HttpError, senriError } from "./errors.ts";

// Standard Schema の仕様の型(仕様は、ライブラリ側が依存せずに済むよう、型を写して使うことを勧めている)
/**
 * A schema that implements Standard Schema v1 (https://standardschema.dev), such as one from Zod, Valibot or ArkType.
 * The type is copied from the spec, so Senri does not depend on any schema library.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    /** The Standard Schema interface. */
    readonly "~standard": {
        /** The version of the spec. */
        readonly version: 1;
        /** The name of the library that made the schema. */
        readonly vendor: string;
        /** Validates a value, returning the output value or the issues. */
        readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
        /** The input and output types, for type inference only. */
        readonly types?: { readonly input: Input; readonly output: Output } | undefined;
    };
}

/** The result of a {@link StandardSchemaV1} validation: the output value, or the issues. */
export type StandardResult<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: readonly StandardIssue[] };

/** One validation problem reported by a schema library. */
export type StandardIssue = {
    /** The library's message. */
    readonly message: string;
    /** Where the problem is in the value, if known. */
    readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
};

// 送る側(クライアント)が渡す型。変換の前の形
/** The input type of a {@link StandardSchemaV1} (before any transforms): what a client sends. */
export type InferInput<S> = S extends StandardSchemaV1<infer Input, any> ? Input : never;

/** The output type of a {@link StandardSchemaV1} (after any transforms). */
export type InferOutput<S> = S extends StandardSchemaV1<any, infer Output> ? Output : never;

// スキーマなしで、パスの値を整数として読む: { params: { id: "uint" } }(#142)
// - "int": 0 か、先頭が 0 でない数字の並び(前に "-" を付けてもよい)。^(0|-?[1-9][0-9]*)$ に合い、安全な整数に収まるもの
// - "uint": そのうち 0 以上のもの(id 向け)
// "01"・"1.5"・" 1 "・"+1"・"1e3"・"-0"・MAX_SAFE_INTEGER を超える値などは、整数とみなさずに 404 にする
/**
 * How to read a path parameter without a schema: `"int"` is an integer (negative allowed), `"uint"` an integer of 0 or more.
 * The value must be `0` or digits without a leading zero (with a leading `-` for `"int"`), within `Number.MAX_SAFE_INTEGER`.
 * Anything else (`"01"`, `"1.5"`, `" 1 "`, `"+1"`, `"1e3"`, `"-0"`, ...) gets 404.
 */
export type ParamType = "int" | "uint";

/** Path parameters read as integers: `{ id: "uint" }`. Each key is a parameter name in the path. */
export type ParamTypes = { readonly [name: string]: ParamType };

/**
 * Schemas passed to a route: `app.post(path, { params, query, body }, handler)`.
 * They are checked in the order params, query, body; if one fails, the handler is not called and a
 * {@link ValidationError} (400) is thrown.
 */
export type RouteSchemas = {
    /**
     * Validates the path parameters. The output replaces the handler's first argument and `c.params`.
     * Instead of a schema, `{ id: "int" }` or `{ id: "uint" }` reads the parameter as an integer ({@link ParamType});
     * if it is not one, the handler is not called and the response is 404 (the `app.notFound` handler).
     */
    params?: StandardSchemaV1 | ParamTypes;
    /** Validates `c.query()`. The output is available as `c.valid("query")`. */
    query?: StandardSchemaV1;
    /** Validates `c.body()`. The output is available as `c.valid("body")`. */
    body?: StandardSchemaV1;
};

// c.valid() で読めるもの(スキーマを渡したものだけ)
/** What `c.valid()` can read: the outputs of the route's `query` and `body` schemas. */
export type Validated<S extends RouteSchemas> = {
    [K in keyof S & ("query" | "body")]: InferOutput<S[K]>;
};

// params のスキーマがあれば、その変換後の型。なければパスから取り出した型
// { id: "int" } なら、その名前だけ number にする
/**
 * The handler's first argument: the `params` schema's output, `Fallback` (the parameters from the path) with the
 * names in {@link ParamTypes} as `number`, or `Fallback`.
 */
// (S が any のとき any になるよう、S["params"] で読む。defineRoutes() の表の型が、どの endpoint も受けられるように)
export type ValidatedParams<S extends RouteSchemas, Fallback> = S extends { params: StandardSchemaV1 }
    ? InferOutput<S["params"]>
    : S extends { params: ParamTypes }
      ? { [K in keyof Fallback]: K extends keyof S["params"] ? number : Fallback[K] }
      : Fallback;

// { id: "int" } の名前がパスにないときに、型エラーにする(スキーマのときは何もしない)
/** Rejects names in {@link ParamTypes} that are not parameters of the path (`P`). Schemas are not checked. */
export type CheckParamTypes<S, P> = S extends { params: infer T }
    ? T extends StandardSchemaV1
        ? unknown
        : { params: { [K in keyof T]: K extends keyof P ? ParamType : `"${K & string}" is not a parameter of this path` } }
    : unknown;

/** Which part of the request failed validation. */
export type ValidationTarget = "params" | "query" | "body";

// バリデーションに通らなかった。issues はスキーマのライブラリが返したもの
// app.onError で受けて、自分の形(JSON など)で返すこともできる
// (開発モードの「どこが違うか」の一覧は @senrijs/senri/dev が組み立てる)
/**
 * Thrown when a route's schema rejects the request. An {@link HttpError} with status 400 and the message
 * `"400 Bad Request"` (the issues are not in the message). Handle it in `app.onError` to return your own format.
 */
export class ValidationError extends HttpError {
    /** Which part of the request failed. */
    readonly target: ValidationTarget;
    /** The issues returned by the schema library. */
    readonly issues: readonly StandardIssue[];

    /** Created by Senri when validation fails. */
    constructor(target: ValidationTarget, issues: readonly StandardIssue[]) {
        // 本番の本文(message)には中身を出さない(スキーマの作りをそのまま外に見せないため)
        super(400, "400 Bad Request");
        this.name = "ValidationError";
        this.target = target;
        this.issues = issues;
    }
}

async function run(schema: StandardSchemaV1, target: ValidationTarget, value: unknown): Promise<unknown> {
    const result = await schema["~standard"].validate(value);
    if (result.issues) throw new ValidationError(target, result.issues);
    return result.value;
}

// 整数として読めなかったパスの値。開発モードの 404 が「:id に整数でない値 "abc" が来ました」と出すのに使う
/** A path parameter that could not be read as its {@link ParamType}. Used by `@senrijs/senri/dev`. */
export type ParamMiss = { name: string; value: string; type: ParamType };
export const paramMisses = new WeakMap<Context, ParamMiss>();

// "-0" は弾く(-0 と 0 は別の値ではないが、"-0" と書く理由がない)
const INT = /^(?:0|-?[1-9][0-9]*)$/;

// { id: "int" } の通りに読む。読めなければ c.notFound()(app.notFound のハンドラーに回る)
function readParams(types: ParamTypes, params: Record<string, string>, c: Context): Record<string, unknown> {
    const out: Record<string, unknown> = { ...params };
    for (const name in types) {
        const type = types[name]!;
        const value = params[name];
        // 型と開発モードで登録時に止めるが、createRouter のルートなどで通ってきたとき
        if (value === undefined) throw senriError("param_unknown", new TypeError(`Unknown parameter: ${name}`));
        const n = Number(value);
        if (!INT.test(value) || !Number.isSafeInteger(n) || (type === "uint" && n < 0)) {
            paramMisses.set(c, { name, value, type });
            c.notFound();
        }
        out[name] = n;
    }
    return out;
}

// スキーマで確かめてからハンドラーを呼ぶハンドラーにする。params → query → body の順に確かめる
export function withValidation(schemas: RouteSchemas, handler: Handler): Handler {
    const p = schemas.params;
    // スキーマでなければ { id: "int" } の表。値の書き間違いは登録した時点で止める
    const types = typeof p === "object" && p !== null && !("~standard" in p) ? p : undefined;
    if (types) {
        for (const name in types) {
            if (types[name] !== "int" && types[name] !== "uint") {
                // 本体の文言は短く。開発モードでは code から説明を付ける(src/dev/explain.ts)
                throw senriError("param_type", new TypeError(`Invalid parameter type: ${name}`));
            }
        }
    }
    return async (params, c: Context) => {
        let validParams = params;
        if (types) {
            validParams = readParams(types, params, c) as Record<string, string>;
            c.params = validParams;
        } else if (p) {
            validParams = (await run(p as StandardSchemaV1, "params", params)) as Record<string, string>;
            c.params = validParams;
        }
        if (schemas.query) setValidated(c, "query", await run(schemas.query, "query", c.query()));
        if (schemas.body) setValidated(c, "body", await run(schemas.body, "body", await c.body()));
        return handler(validParams, c);
    };
}

// app.get(path, handler) と app.get(path, { params, query, body }, handler) のどちらか
// 2つ目の引数がスキーマなら、確かめてからハンドラーを呼ぶものにする
// (スキーマの書き間違いは、開発モードで登録した時点で知らせる。@senrijs/senri/dev の validation.ts)
export function routeHandler(path: string, a: Handler | RouteSchemas, b: Handler | undefined): Handler {
    if (typeof a === "function") return a;
    if (typeof b !== "function") throw senriError("no_handler", `Missing handler: ${path}`);
    return withValidation(a, b);
}
