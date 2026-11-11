/**
 * OpenAPI documents from tables made with `defineRoutes()`: `openAPI(routes, { info })`.
 * Schemas are converted with Standard JSON Schema (`~standard.jsonSchema`, supported by Zod 4.2+, ArkType 2.1.28+,
 * Valibot 1.2+ through `@valibot/to-json-schema`, and others), so no converter package per library is needed.
 *
 * @example
 * ```ts
 * import { openAPI } from "@senrijs/senri/openapi";
 *
 * const doc = openAPI(routes, { info: { title: "My API", version: "1.0.0" } });
 * app.get("/openapi.json", () => doc);
 * ```
 *
 * @module
 */
// OpenAPI の文書を作る(docs/design/0.3.0.md の 2)
// - 元は defineRoutes() の表。表にない app.get() のルートは入れない(スキーマもレスポンスの形も分からないため)
// - スキーマは Standard JSON Schema で JSON Schema にする。リクエスト(params・query・body)は input、レスポンスは output
// - JSON Schema にできないスキーマは、空のスキーマ({})にして警告する(黙って抜かさない)
// - 本体の実行時のコードは読まない(表の値は形で見分ける)
import type { OpenAPIOperationInfo } from "./routes.ts";
import type { StandardSchemaV1 } from "./validate.ts";

/** A JSON Schema object (or an OpenAPI 3.0 Schema Object). */
export type JSONSchema = Record<string, unknown>;

/** Converts a schema without Standard JSON Schema support. Return `undefined` if it cannot be converted. */
export type ToJSONSchema = (
    schema: StandardSchemaV1,
    context: { io: "input" | "output"; target: "draft-2020-12" | "openapi-3.0" },
) => JSONSchema | undefined;

/** Options for {@link openAPI}. */
export type OpenAPIOptions = {
    /** The `info` object: `title` and `version` are required. */
    info: { title: string; version: string; description?: string; [key: string]: unknown };
    /** The OpenAPI version: `"3.1"` (default, JSON Schema 2020-12) or `"3.0"`. */
    version?: "3.1" | "3.0";
    /** The `servers` list. */
    servers?: { url: string; description?: string }[];
    /** Security requirements for every operation, such as `[{ bearerAuth: [] }]`. A route's `openapi.security` replaces it. */
    security?: Record<string, string[]>[];
    /** The `components` object (for `securitySchemes`, for example). */
    components?: Record<string, unknown>;
    /** The `tags` list (names and descriptions). */
    tags?: { name: string; description?: string }[];
    /** Converts schemas without Standard JSON Schema support (an older library version, for example). */
    toJSONSchema?: ToJSONSchema;
    /** Called for each problem (a schema that cannot be converted, a method OpenAPI does not have). Default: `console.warn`. */
    onWarning?: (message: string) => void;
};

type Schemas = {
    params?: StandardSchemaV1;
    query?: StandardSchemaV1;
    body?: StandardSchemaV1;
    response?: StandardSchemaV1;
    responses?: Record<number, StandardSchemaV1>;
    bodyType?: "json" | "form";
    openapi?: OpenAPIOperationInfo;
};

// Standard JSON Schema の形(使うところだけ)
type WithJSONSchema = {
    "~standard": {
        jsonSchema?: {
            input(options: { target: string }): JSONSchema;
            output(options: { target: string }): JSONSchema;
        };
    };
};

// OpenAPI にあるメソッド(3.0 / 3.1)。QUERY などはまだない
const METHODS = new Set(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);

const STATUS_TEXT: Record<number, string> = { 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 422: "Unprocessable Content", 500: "Internal Server Error" };

// 表の値から、スキーマなどを取り出す(endpoint() の値は { schemas, handler }。ハンドラーだけなら何もない)
function schemasOf(value: unknown): Schemas {
    if (typeof value === "object" && value !== null && "schemas" in value) return (value as { schemas: Schemas }).schemas ?? {};
    return {};
}

/**
 * Creates an OpenAPI document (3.1 by default) from a table made with `defineRoutes()`.
 *
 * - Paths and methods come from the keys (`"GET /users/:id"` → `paths["/users/{id}"].get`). A wildcard (`*`) becomes
 *   a `{path}` parameter. Methods that OpenAPI does not have (such as `QUERY`) are skipped with a warning.
 * - Path parameters are strings, or typed by the route's `params` schema. `query` becomes query parameters (the
 *   schema must be an object), `body` the request body (`application/json`, or form types with `bodyType: "form"`).
 * - Responses come from `endpoint({ response, responses })`. Without them, only a `200` without a schema is listed:
 *   handler return types are not known at runtime.
 * - Request schemas are converted as input and response schemas as output, with Standard JSON Schema
 *   (`~standard.jsonSchema`). Others go through `options.toJSONSchema`; if that is missing or fails, the schema is
 *   left empty (`{}`) and a warning is given.
 * - `endpoint({ openapi })` fields (summary, description, tags, operationId, deprecated, security) are copied as they are.
 *
 * Routes registered with `app.get()` and others are not included; put them in a table to document them.
 *
 * @example
 * ```ts
 * import { openAPI } from "@senrijs/senri/openapi";
 *
 * const doc = openAPI(routes, {
 *     info: { title: "My API", version: "1.0.0" },
 *     components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
 * });
 * app.get("/openapi.json", () => doc);
 * ```
 */
export function openAPI(routes: object, options: OpenAPIOptions): JSONSchema {
    const v30 = options.version === "3.0";
    const target = v30 ? "openapi-3.0" : "draft-2020-12";
    const warn = options.onWarning ?? ((message: string) => console.warn(`[senri] openAPI(): ${message}`));

    // スキーマを JSON Schema にする。できなければ {} と警告
    const convert = (schema: StandardSchemaV1, io: "input" | "output", where: string): JSONSchema => {
        try {
            const standard = (schema as unknown as WithJSONSchema)["~standard"].jsonSchema;
            const out = standard ? standard[io]({ target }) : options.toJSONSchema?.(schema, { io, target });
            if (out) {
                // 文書の中に置くので、$schema は外す
                const { $schema: _, ...rest } = out;
                return rest;
            }
            warn(`${where}: the schema has no JSON Schema conversion (~standard.jsonSchema). Pass toJSONSchema, or use a library version that supports Standard JSON Schema`);
        } catch (err) {
            warn(`${where}: the schema cannot be converted to JSON Schema (${err instanceof Error ? err.message : String(err)})`);
        }
        return {};
    };

    const paths: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(routes)) {
        const space = key.indexOf(" ");
        const method = key.slice(0, space).toUpperCase();
        const path = key.slice(space + 1);
        if (!METHODS.has(method)) {
            warn(`${key}: OpenAPI has no ${method} method, so this route is not included`);
            continue;
        }
        const schemas = schemasOf(value);

        // パス: ":id" → "{id}"、最後の "*" → "{path}"
        const names: string[] = [];
        const openPath =
            "/" +
            path
                .split("/")
                .filter(Boolean)
                .map((segment) => {
                    if (segment === "*") return (names.push("*"), "{path}");
                    if (segment.startsWith(":")) return (names.push(segment.slice(1)), `{${segment.slice(1)}}`);
                    return segment;
                })
                .join("/");

        const parameters: Record<string, unknown>[] = [];
        // パスパラメーター。params のスキーマがあれば、そのプロパティの型
        const paramsSchema = schemas.params ? convert(schemas.params, "input", `${key} params`) : undefined;
        const paramProps = (paramsSchema?.properties ?? {}) as Record<string, JSONSchema>;
        for (const name of names) {
            const wildcard = name === "*";
            parameters.push({
                name: wildcard ? "path" : name,
                in: "path",
                required: true,
                ...(wildcard ? { description: "The rest of the path (may contain /)" } : {}),
                schema: paramProps[name] ?? { type: "string" },
            });
        }
        // クエリ: オブジェクトのスキーマのプロパティを、1 つずつパラメーターにする
        if (schemas.query) {
            const query = convert(schemas.query, "input", `${key} query`);
            const props = query.properties as Record<string, JSONSchema> | undefined;
            if (props) {
                const required = new Set((query.required as string[] | undefined) ?? []);
                for (const [name, schema] of Object.entries(props)) {
                    parameters.push({ name, in: "query", required: required.has(name), schema });
                }
            } else if (Object.keys(query).length > 0) {
                warn(`${key} query: the schema must be an object to become query parameters`);
            }
        }

        const operation: Record<string, unknown> = {};
        if (parameters.length > 0) operation.parameters = parameters;
        if (schemas.body) {
            const schema = convert(schemas.body, "input", `${key} body`);
            const types = schemas.bodyType === "form" ? ["application/x-www-form-urlencoded", "multipart/form-data"] : ["application/json"];
            operation.requestBody = { required: true, content: Object.fromEntries(types.map((type) => [type, { schema }])) };
        }

        // レスポンス: response(200)と responses(status ごと)。書いていなければ、スキーマのない 200
        const responses: Record<string, unknown> = {};
        const describe = (status: number, schema: StandardSchemaV1 | undefined, where: string) => {
            const description = STATUS_TEXT[status] ?? String(status);
            if (!schema) return { description };
            const json = convert(schema, "output", where);
            const type = json.type === "string" ? "text/plain" : "application/json";
            return { description, content: { [type]: { schema: json } } };
        };
        responses["200"] = describe(200, schemas.response, `${key} response`);
        for (const [status, schema] of Object.entries(schemas.responses ?? {})) {
            responses[status] = describe(Number(status), schema, `${key} responses[${status}]`);
        }
        operation.responses = responses;

        const info = schemas.openapi ?? {};
        Object.assign(operation, info);
        if (!info.security && options.security) operation.security = options.security;

        (paths[openPath] ??= {})[method.toLowerCase()] = operation;
    }

    return {
        openapi: v30 ? "3.0.3" : "3.1.0",
        info: options.info,
        ...(options.servers ? { servers: options.servers } : {}),
        ...(options.tags ? { tags: options.tags } : {}),
        paths,
        ...(options.components ? { components: options.components } : {}),
    };
}
