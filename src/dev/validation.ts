// バリデーションの、開発モードだけの部分(本体を小さくするため、本体の src/validate.ts から分けている)
// - 登録した時点で、スキーマの書き間違いに気づけるようにする
// - 通らなかったとき、どこが違うかを一覧にする
import { senriError } from "../errors.ts";
import type { RouteSchemas, StandardIssue, StandardSchemaV1, ValidationError, ValidationTarget } from "../validate.ts";

const LABEL: Record<ValidationTarget, string> = {
    params: "パスパラメーター",
    query: "クエリ",
    body: "ボディ",
};

// ["user", 0, "name"] → "user[0].name"
function issuePath(issue: StandardIssue): string {
    let out = "";
    for (const part of issue.path ?? []) {
        const key = typeof part === "object" ? part.key : part;
        if (typeof key === "number") out += `[${key}]`;
        else out += out ? `.${String(key)}` : String(key);
    }
    return out;
}

// 開発モードで返す、どこが違うかの一覧
export function describeValidation(err: ValidationError): string {
    const lines = err.issues.map((issue) => {
        const path = issuePath(issue);
        return `- ${path ? `${path}: ` : ""}${issue.message}`;
    });
    return [`400 Bad Request: ${LABEL[err.target]}が、スキーマに合いません`, ...lines].join("\n");
}

// ArkType のスキーマは関数なので、オブジェクトでも関数でもよい
function isSchema(value: unknown): value is StandardSchemaV1 {
    return (typeof value === "object" || typeof value === "function") && value !== null && "~standard" in value;
}

// スキーマを確かめておく(書き間違いに、登録した時点で気づけるように)
export function checkSchemas(path: string, schemas: RouteSchemas): void {
    if (typeof schemas !== "object" || schemas === null) {
        throw senriError("schema_shape", new TypeError(`${path}: 2つ目の引数には { params, query, body } のスキーマかハンドラーを渡してください`));
    }
    for (const [key, schema] of Object.entries(schemas)) {
        if (key !== "params" && key !== "query" && key !== "body") {
            throw senriError("schema_key", new TypeError(`${path}: スキーマに渡せるのは params / query / body だけです("${key}" は使えません)`));
        }
        if (schema !== undefined && !isSchema(schema)) {
            throw senriError(
                "schema_type",
                new TypeError(`${path}: ${key} が Standard Schema のスキーマではありません(Zod・Valibot・ArkType などのスキーマを渡してください)`),
            );
        }
    }
}
