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
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
        readonly types?: { readonly input: Input; readonly output: Output } | undefined;
    };
}

type StandardResult<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: readonly StandardIssue[] };

export type StandardIssue = {
    readonly message: string;
    readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
};

export type InferOutput<S> = S extends StandardSchemaV1<any, infer Output> ? Output : never;

export type RouteSchemas = {
    params?: StandardSchemaV1;
    query?: StandardSchemaV1;
    body?: StandardSchemaV1;
};

// c.valid() で読めるもの(スキーマを渡したものだけ)
export type Validated<S extends RouteSchemas> = {
    [K in keyof S & ("query" | "body")]: InferOutput<S[K]>;
};

// params のスキーマがあれば、その変換後の型。なければパスから取り出した型
export type ValidatedParams<S extends RouteSchemas, Fallback> = S extends { params: StandardSchemaV1 }
    ? InferOutput<S["params"]>
    : Fallback;

export type ValidationTarget = "params" | "query" | "body";

// バリデーションに通らなかった。issues はスキーマのライブラリが返したもの
// app.onError で受けて、自分の形(JSON など)で返すこともできる
// (開発モードの「どこが違うか」の一覧は @senrijs/senri/dev が組み立てる)
export class ValidationError extends HttpError {
    readonly target: ValidationTarget;
    readonly issues: readonly StandardIssue[];

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

// スキーマで確かめてからハンドラーを呼ぶハンドラーにする。params → query → body の順に確かめる
export function withValidation(schemas: RouteSchemas, handler: Handler): Handler {
    return async (params, c: Context) => {
        let validParams = params;
        if (schemas.params) {
            validParams = (await run(schemas.params, "params", params)) as Record<string, string>;
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
