/**
 * A small web framework built on the standard `Request` / `Response`.
 * Runs on Bun, Deno, Node.js, Cloudflare Workers and in the browser (Service Worker).
 * This entry has the app, router, context, errors, validation and the built-in middleware.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 *
 * const app = createApp();
 * app.get("/hello/:name", ({ name }) => `Hello, ${name}`);
 *
 * // Pass app.fetch to your runtime (Bun.serve, Deno.serve), or `export default app` on Cloudflare Workers.
 * ```
 *
 * @module
 */
// @senrijs/senri の入口
// 開発モード(エラーページ・ダッシュボードなど)は @senrijs/senri/dev、Cookie は @senrijs/senri/cookie、接続元の IP は @senrijs/senri/ip
export {
    createApp,
    type App,
    type AppCore,
    type AppOptions,
    type DevHooks,
    type DevInstalled,
    type MountableApp,
    type OnMethod,
    type Resolved,
    type RouteMethod,
} from "./app.ts";
export type { ExtractParams, ParamName, Route, RouteTable, Segment, Simplify } from "./router.ts";
export { createRouter, type Router, type RouterMethod, type RouterParams } from "./group.ts";
export {
    Context,
    type BindingsOf,
    type BodyValue,
    type ExecutionContext,
    type Handler,
    type HandlerResult,
    type JsonObject,
    type TypedResponse,
    type Middleware,
    type Next,
    type RedirectStatus,
    type VariablesOf,
} from "./context.ts";
export { HttpError, type ErrorHandler, type NotFoundHandler } from "./errors.ts";
export {
    defineRoutes,
    endpoint,
    mergeRoutes,
    type Endpoint,
    type EndpointOptions,
    type JoinPath,
    type MergeRoutes,
    type MiddlewareVars,
    type OpenAPIOperationInfo,
    type RouteMiddleware,
    type RouteParams,
    type Routes,
    type RoutesTable,
    type RoutesWithUse,
    type TableOptions,
    type TableShape,
    type UnionToIntersection,
} from "./routes.ts";
export {
    ValidationError,
    type InferInput,
    type InferOutput,
    type RouteSchemas,
    type StandardIssue,
    type StandardResult,
    type StandardSchemaV1,
    type Validated,
    type ValidatedParams,
    type ValidationTarget,
} from "./validate.ts";
export type { CookieOptions } from "./cookie-header.ts";
export type { FormBody, FormValue } from "./body.ts";
export type { Layer, Timing, Trace } from "./compose.ts";
export { logger, showRoutes, type LoggerOptions, type RouteSummary } from "./logger.ts";
export { health, type HealthOptions } from "./health.ts";
export { cors, type CorsOptions } from "./middleware/cors.ts";
export { csrf, type CsrfOptions } from "./middleware/csrf.ts";
export type { OriginOption } from "./middleware/origin.ts";
export { secureHeaders, type SecureHeaderValue, type SecureHeadersOptions } from "./middleware/secure-headers.ts";
export { bodyLimit, type BodyLimitOptions } from "./middleware/body-limit.ts";
export { requestId, type RequestIdOptions, type RequestIdVariables } from "./middleware/request-id.ts";
export { timeout, type TimeoutOptions } from "./middleware/timeout.ts";
export { basicAuth, bearerAuth, type BasicAuthOptions, type BearerAuthOptions } from "./middleware/auth.ts";
export { etag, type EtagOptions } from "./middleware/etag.ts";
export { compress, type CompressOptions } from "./middleware/compress.ts";
export { rateLimit, type RateLimitEntry, type RateLimitOptions, type RateLimitStore } from "./middleware/rate-limit.ts";
export { ipRestriction, type IpRestrictionOptions } from "./middleware/ip-restriction.ts";
export { prettyJSON, type PrettyJSONOptions } from "./middleware/pretty-json.ts";
export { safeFileName, uploadLimit, type UploadLimitOptions } from "./middleware/upload-limit.ts";
export { languageDetector, type LanguageDetectorOptions, type LanguageSource, type LanguageVariables } from "./middleware/language-detector.ts";
export { cache, type CacheOptions } from "./middleware/cache.ts";
export { trailingSlash, type TrailingSlashOptions } from "./middleware/trailing-slash.ts";
export { methodOverride, type MethodOverrideOptions, type MethodOverrideTarget } from "./middleware/method-override.ts";
