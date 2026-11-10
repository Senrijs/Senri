/**
 * Test helpers: call an app without starting a server.
 * `testClient<Api>(app)` is the typed client from `@senrijs/senri/client` wired to `app.fetch`;
 * `request(app, "GET /path")` sends an untyped request and returns the `Response`.
 *
 * @example
 * ```ts
 * import { testClient } from "@senrijs/senri/testing";
 * import type { Api } from "./routes.ts";
 *
 * const api = testClient<Api>(app);
 * const res = await api("POST /users", { body: { name: "a" } });
 * expect(res.status).toBe(200);
 * ```
 *
 * @module
 */
// テスト用ヘルパー(docs/design/0.3.0.md の 3)
// - testClient: @senrijs/senri/client のクライアントの fetch を app.fetch にしたもの
// - request: 型のないリクエスト(表にないルートや、壊れたリクエストを送るテスト向け)
// どちらも、接続元を 127.0.0.1 として渡す(getIp()・ipRestriction()・開発モードの localhost 判定が、本物のサーバーと同じに動く)
// Workers のアプリ向けに env と ctx を渡せる(そのときは接続元は渡さない。Workers と同じく、接続元は分からない)
import { client, type Client } from "./client.ts";

/** An app to test: anything with `fetch(req, info?, ctx?)`, such as an app from `createApp()`. */
export type TestApp = {
    fetch(req: Request, info?: any, ctx?: any): Response | Promise<Response>;
};

/** Options for {@link testClient} and {@link request}. */
export type TestOptions = {
    /** Headers sent with every request. A function is called for each request. */
    headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
    /** The client's address, as seen by `getIp()` and `ipRestriction()`. Default `"127.0.0.1"`. Not used with `env`. */
    ip?: string;
    /** Cloudflare Workers' `env` (bindings), passed as the second argument of `app.fetch` (`c.env`). */
    env?: object;
    /** Cloudflare Workers' execution context, passed as the third argument of `app.fetch` (`c.executionCtx`). */
    ctx?: { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void };
    /**
     * Keep cookies: send cookies set by earlier responses (`Set-Cookie`) with later requests. Default `false`.
     * The jar is simple: one value per name, no domain or path matching; `Max-Age=0` or a past `Expires` removes it.
     */
    cookies?: boolean;
    /** The URL requests are sent to. Default `"http://localhost"`. */
    baseUrl?: string;
};

// Cookie の箱。名前ごとに 1 つ(テスト用なので、domain と path は見ない)
function cookieJar() {
    const jar = new Map<string, string>();
    return {
        header(): string | null {
            return jar.size === 0 ? null : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
        },
        store(res: Response) {
            for (const line of res.headers.getSetCookie()) {
                const [pair = "", ...attrs] = line.split(";");
                const eq = pair.indexOf("=");
                if (eq <= 0) continue;
                const name = pair.slice(0, eq).trim();
                const value = pair.slice(eq + 1).trim();
                const expired = attrs.some((attr) => {
                    const [key = "", val = ""] = attr.split("=").map((s) => s.trim());
                    if (key.toLowerCase() === "max-age") return Number(val) <= 0;
                    if (key.toLowerCase() === "expires") return Date.parse(val) <= Date.now();
                    return false;
                });
                if (expired) jar.delete(name);
                else jar.set(name, value);
            }
        },
    };
}

// app.fetch を、テスト用の接続元・env・ctx・Cookie で呼ぶ fetch にする
function appFetch(app: TestApp, options: TestOptions): (req: Request) => Promise<Response> {
    const jar = options.cookies ? cookieJar() : null;
    // env がなければ、Deno と同じ形の接続元(@senrijs/senri/node のアダプターも同じ形で渡す)
    const info = options.env ?? { remoteAddr: { hostname: options.ip ?? "127.0.0.1", port: 0, transport: "tcp" } };
    return async (req) => {
        const cookie = jar?.header();
        if (cookie) {
            req = new Request(req);
            // 呼ぶ側が自分で付けた Cookie を先にする
            const own = req.headers.get("cookie");
            req.headers.set("cookie", own ? `${own}; ${cookie}` : cookie);
        }
        const res = await app.fetch(req, info, options.ctx);
        jar?.store(res);
        return res;
    };
}

/**
 * The typed client from `@senrijs/senri/client`, calling `app.fetch` directly (no server).
 * Pass the type of a table from `defineRoutes()`: `testClient<typeof routes>(app)`.
 * The client address is `127.0.0.1` (change it with `ip`); give `env` and `ctx` for a Cloudflare Workers app;
 * `cookies: true` keeps cookies between calls (for login flows).
 *
 * @example
 * ```ts
 * import { testClient } from "@senrijs/senri/testing";
 *
 * const api = testClient<Api>(app, { cookies: true });
 * await api("POST /login", { body: { user: "a", password: "x" } });
 * const me = await api("GET /me");
 * expect(me.ok && me.data.name).toBe("a");
 * ```
 */
export function testClient<A>(app: TestApp, options: TestOptions = {}): Client<A> {
    return client<A>(options.baseUrl ?? "http://localhost", {
        ...(options.headers === undefined ? {} : { headers: options.headers }),
        fetch: appFetch(app, options),
    });
}

/**
 * Sends a request to `app.fetch` without a server and returns the `Response`. The route is `"METHOD /path"`,
 * and the path may have a query (`"GET /search?q=a"`). `init` is passed to `new Request()` (headers, body, ...).
 * Use it for routes that are not in a table from `defineRoutes()`, or to send requests the typed client cannot.
 *
 * @example
 * ```ts
 * import { request } from "@senrijs/senri/testing";
 *
 * const res = await request(app, "POST /upload", { body: form });
 * expect(res.status).toBe(413);
 * ```
 */
export async function request(app: TestApp, route: string, init: RequestInit = {}, options: TestOptions = {}): Promise<Response> {
    const space = route.indexOf(" ");
    const path = route.slice(space + 1);
    if (space <= 0 || !path.startsWith("/")) throw new TypeError(`Invalid route: "${route}" (e.g. "GET /hello")`);
    const base = (options.baseUrl ?? "http://localhost").replace(/\/+$/, "");
    const shared = typeof options.headers === "function" ? await options.headers() : options.headers;
    const headers = new Headers(shared);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const req = new Request(base + path, { ...init, method: route.slice(0, space).toUpperCase(), headers });
    return appFetch(app, options)(req);
}
