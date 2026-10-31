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

- [ ] When `NODE_ENV` is not set, show dev output only for requests to localhost
- [ ] `create-senri` (`npm create senri`)
- [ ] English / Japanese error messages and dev pages
- [ ] Response helpers: `c.html()`, `c.redirect()`, `c.notFound()`
- [ ] SSE / streaming helpers (`c.stream()` and more)
- [ ] File uploads: size/type validation, streaming large files
- [ ] More middleware: Basic / Bearer auth, compression, ETag, request ID, timeout
- [ ] More middleware: method override, trailing-slash normalization, IP restriction, cache, language detection, pretty JSON
- [ ] Performance: a fast path for string responses, HTTP benchmarks with oha (after the helpers)

## 0.3.0 — All the way to production

- [ ] Typed client (RPC)
- [ ] OpenAPI generation
- [ ] Testing helpers
- [ ] OpenTelemetry: the onion timeline becomes production traces
- [ ] Prometheus metrics
- [ ] WebSocket
- [ ] JWT, CSRF protection
- [ ] Context storage (access `c` anywhere)
- [ ] API cleanup: hide unintentionally public exports (`parseCookies`, `serializeCookie`, `deletionCookie`, `resolvePort`, `DEFAULT_PORT`, `PortSource`, `isLocalUrl`), and stop public types from referring to private ones
- [ ] `serveStatic` symlink hardening (re-check that the opened file is inside the root)

## 0.4.0 — Deploy anywhere

- [ ] `senri build --target workers | docker | k8s`

## Later

- Proxy, SSG, cron (e.g. Workers `scheduled`)
- **Ippo** — a React (and later Vue) meta-framework built on Senri
