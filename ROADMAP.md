# Roadmap

> 千里の道も一歩から。 — A journey of a thousand miles begins with a single step.

This is where Senri is heading. Versions are goals, not dates, and the plan may change based on feedback.
Ideas and requests are welcome in [Issues](https://github.com/Senrijs/Senri/issues).

**English** · [日本語](./ROADMAP.ja.md)

## Already built

- Web-standard core (`Request` → `Response`) running on **Bun, Deno, Node.js, Cloudflare Workers and browsers**
- `serve(app)` that detects the runtime (port: explicit → `PORT` → `3927`)
- Router with path params passed as the first argument, static-first priority, friendly 404 / 405
- Return values become responses (string → text, object → JSON)
- Context (`c.status`, `c.header`, `c.json`, `c.text`, `c.set` / `c.get`), `HttpError`, `onError`, `notFound`
- Onion-model middleware, path-scoped middleware
- Path parameter type inference
- Logger (pretty / pino-compatible JSON)
- Dev mode: error page (failing line, hints, open in editor) and 404 page ("did you mean…?")
- `/_senri` dev dashboard: live requests, onion timeline, routes and middleware

## 0.1.0 — First release (released 2026-10-26)

*Usable today, a dev experience you won't find elsewhere, and it runs everywhere.*

- [x] Query, body and cookie helpers
- [x] Route groups (`app.route(prefix, subApp)`)
- [x] `app.on`, `app.options`, `app.head`
- [x] `QUERY` method ([RFC 10008](https://www.rfc-editor.org/rfc/rfc10008.html))
- [x] Built-in middleware: CORS, static files, secure headers, body limit
- [x] Cloudflare Workers support (`export default app`, `c.env`, `c.executionCtx`)
- [x] Validation with [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType, …)
- [x] `/healthz` / `/readyz` and graceful shutdown
- [x] Performance: reproducible benchmarks, faster router (Map + Trie), lower per-request overhead
- [x] `c.ip`
- [x] `Server-Timing` header in dev mode (see the onion in your browser's DevTools)
- [x] Published to npm and JSR (both `@senrijs/senri`)

## 0.2.0 — Lighter, and into the browser (released 2026-10-27)

- [x] Browser (Service Worker) support
- [x] Dev tools split out (`devtools()` from `@senrijs/senri/dev`)
- [x] Smaller core (about 14KB minified; cookies and IP moved to their own entries)

## 0.2.1 / 0.2.2 — Post-release fixes

See the [CHANGELOG](./CHANGELOG.md) for details.

- [x] JSDoc for every entrypoint (JSR score 100%)
- [x] Automated releases with Release Please (versions, CHANGELOG, publishing to npm and JSR)
- [x] `__Host-` / `__Secure-` cookie handling (`Secure` when deleting, `domain` and `path` checks, case-insensitive prefixes)
- [x] `serve()` fixes (`hostname` on Node.js, exit immediately on a second signal)
- [x] `bodyLimit` responds with 413 whatever `onError` returns
- [x] Dev pages no longer load external fonts

## 0.2.x — Everyday development without friction

- [x] When `NODE_ENV` is not set, show dev output only for requests to localhost
- [x] `create-senri` (`npm create senri`)
- [x] English / Japanese dev pages and terminal messages (`devtools({ lang })`, or automatic from `Accept-Language` and `LANG`)
- [x] Error messages that also appear in production: all in English
- [x] Response helpers: `c.html()`, `c.redirect()`
- [x] Response helper: `c.notFound()`
- [x] SSE / streaming helpers (`stream()`, `streamText()` and `streamSSE()` from `@senrijs/senri/streaming`; not Context methods, so apps that do not use them stay small)
- [x] File uploads: size and type validation (`uploadLimit()`)
- [x] File uploads: receiving large files as a stream, without holding them in memory (`multipart()` from `@senrijs/senri/multipart`)
- [x] Middleware: request ID (`requestId()`)
- [x] Middleware: timeout (`timeout()`)
- [x] Middleware: Basic / Bearer auth (`basicAuth()`, `bearerAuth()`)
- [x] Middleware: ETag (`etag()`)
- [x] Middleware: compression (`compress()`)
- [x] Middleware: IP restriction (`ipRestriction()`)
- [x] Middleware: rate limiting (`rateLimit()`)
- [x] Middleware: method override (`methodOverride()`)
- [x] Middleware: trailing-slash normalization (`trailingSlash()`)
- [x] Middleware: cache headers (`cache()`)
- [x] Middleware: language detection (`languageDetector()`)
- [x] Middleware: pretty JSON (`prettyJSON()`)
- [x] Performance: a fast path for string responses (no Request or Response on Node.js, including the default 404), no Host header read on Bun, HTTP benchmarks with wrk (Bun, Node.js and Deno)
- [x] Trusted-proxy support (`trustProxy()`; counts proxies from the right and never trusts the first `X-Forwarded-For` value)
- [x] Documentation site (senri.skyia.jp): the top page, 404 page, playground and docs (Japanese and English)

## 0.3.0 — All the way to production (released 2026-11-12)

- [x] Typed client (RPC)
- [x] OpenAPI generation
- [x] Testing helpers
- [x] OpenTelemetry: the onion timeline becomes production traces
- [x] Prometheus metrics
- [x] WebSocket
- [x] JWT
- [x] CSRF protection
- [x] Signed cookies
- [x] Problem Details (RFC 9457) error responses
- [x] Context storage (access `c` anywhere)
- [x] API cleanup: hide unintentionally public exports (`parseCookies`, `serializeCookie`, `deletionCookie`, `resolvePort`, `DEFAULT_PORT`, `PortSource`, `isLocalUrl`), and stop public types from referring to private ones
- [x] `serveStatic` symlink hardening (re-check that the opened file is inside the root)

## 0.3.1–0.3.4 — Post-release fixes

See the [CHANGELOG](./CHANGELOG.md) for details.

- [x] `c.bodyJson()` and `c.bodyBytes()` (read the body as JSON or bytes)
- [x] Read path parameters as integers without a schema (`"int"` / `"uint"`)
- [x] Faster Node.js middleware and Deno plain text, and an 8 KB size target
- [x] Fix route middleware being dropped from apps mounted with `app.route()`

## 0.4.0 — Deploy anywhere (released 2026-11-21)

- [x] `senri build --target workers | docker | k8s` (`@senrijs/cli`)
- [x] Type the route Context and the typed client from the variables middleware declares

## 0.4.x — Cleanup after 0.4.0

- [ ] Find what can be trimmed from the core to win back size headroom ([#146](https://github.com/Senrijs/Senri/issues/146))
- [ ] Status-code types widen when results go through a shared helper into `c.json` ([#144](https://github.com/Senrijs/Senri/issues/144))
- [ ] Docs: tips for reading the server's types from the web app ([#145](https://github.com/Senrijs/Senri/issues/145))

→ [Milestone](https://github.com/Senrijs/Senri/milestone/3)

## 0.5.0 — Recover from failures

- [ ] Per-route self-healing (take only a failing route offline for a while and bring it back automatically) ([#148](https://github.com/Senrijs/Senri/issues/148))
- [ ] Chaos mode: break things on purpose to get ready for production (latency, errors, exceptions) ([#149](https://github.com/Senrijs/Senri/issues/149))
- [ ] Grow the app's types from `app.use()` ([#160](https://github.com/Senrijs/Senri/issues/160))

→ [Milestone](https://github.com/Senrijs/Senri/milestone/4)

## 0.6.0 — Break it, then trace it

- [ ] Chaos mode: make `fetch` slow or fail ([#186](https://github.com/Senrijs/Senri/issues/186))
- [ ] Record & replay: look at a failed request later and send it again ([#150](https://github.com/Senrijs/Senri/issues/150))

→ [Milestone](https://github.com/Senrijs/Senri/milestone/5)

## 1.0.0 — Lock in the types

Changing types after 1.0 would be a breaking change, so the types get finished first.

- [ ] Check the order of `use` in the types ([#161](https://github.com/Senrijs/Senri/issues/161))
- [ ] Add 404 and 413 to the typed client's types automatically ([#162](https://github.com/Senrijs/Senri/issues/162))
- [ ] The status in the types and at runtime differ for `c.json()` after `c.status()` ([#179](https://github.com/Senrijs/Senri/issues/179))

→ [Milestone](https://github.com/Senrijs/Senri/milestone/6)

## Later

- [ ] Proxy: a helper that forwards requests to another server ([#173](https://github.com/Senrijs/Senri/issues/173))
- [ ] SSG: write routes out as static HTML ([#174](https://github.com/Senrijs/Senri/issues/174))
- [ ] Cron: run work on a schedule (e.g. Workers `scheduled`) ([#175](https://github.com/Senrijs/Senri/issues/175))
- **Ippo** — a React (and later Vue) meta-framework built on Senri