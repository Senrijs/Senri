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
    type Resolved,
} from "./app.ts";
export { createRouter, type Router } from "./group.ts";
export {
    Context,
    type BindingsOf,
    type ExecutionContext,
    type Handler,
    type HandlerResult,
    type Middleware,
    type Next,
    type VariablesOf,
} from "./context.ts";
export { HttpError, type ErrorHandler, type NotFoundHandler } from "./errors.ts";
export {
    ValidationError,
    type InferOutput,
    type RouteSchemas,
    type StandardIssue,
    type StandardSchemaV1,
    type ValidationTarget,
} from "./validate.ts";
export type { CookieOptions } from "./cookie.ts";
export type { FormBody, FormValue } from "./body.ts";
export type { Layer, Timing, Trace } from "./compose.ts";
export { logger, showRoutes, type LoggerOptions } from "./logger.ts";
export { health, type HealthOptions } from "./health.ts";
export { cors, type CorsOptions } from "./middleware/cors.ts";
export { secureHeaders, type SecureHeadersOptions } from "./middleware/secure-headers.ts";
export { bodyLimit, type BodyLimitOptions } from "./middleware/body-limit.ts";
