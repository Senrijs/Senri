// ベンチマークで使う、同じルート一式の Senri / Hono / Elysia アプリ
// どれも本番モード(開発用の計測・記録なし)、ミドルウェアなし、ハンドラーはテキストを返すだけ
import { createApp } from "../src/index.ts";
import { Hono } from "hono";
import { Elysia } from "elysia";

// [メソッド, パス]。Hono のルーターのベンチマークでよく使われる構成を参考にしている
export const ROUTES: [string, string][] = [
    ["GET", "/user"],
    ["GET", "/user/comments"],
    ["GET", "/user/avatar"],
    ["GET", "/user/lookup/username/:username"],
    ["GET", "/user/lookup/email/:address"],
    ["GET", "/event/:id"],
    ["GET", "/event/:id/comments"],
    ["POST", "/event/:id/comment"],
    ["GET", "/map/:location/events"],
    ["GET", "/status"],
    ["GET", "/very/deeply/nested/route/hello/there"],
    ["GET", "/users/:id/posts/:postId/comments/:commentId"],
];

// [名前, メソッド, パス]。最後は 404
export const REQUESTS: [string, string, string][] = [
    ["static (short)", "GET", "/user"],
    ["static (same prefix)", "GET", "/user/comments"],
    ["static (long)", "GET", "/very/deeply/nested/route/hello/there"],
    ["1 param", "GET", "/event/abcd1234"],
    ["1 param + static", "GET", "/event/abcd1234/comments"],
    ["1 param (POST)", "POST", "/event/abcd1234/comment"],
    ["3 params", "GET", "/users/1/posts/2/comments/3"],
    ["not found", "GET", "/not/found/here"],
];

const text = (s: string) => () => s;

export function senriApp() {
    const app = createApp();
    for (const [method, path] of ROUTES) app.on(method, path, text(path));
    return { name: "senri", fetch: (req: Request) => app.fetch(req) };
}

export function honoApp() {
    const app = new Hono();
    for (const [method, path] of ROUTES) app.on(method, path, (c) => c.text(path));
    return { name: "hono", fetch: (req: Request) => app.fetch(req) };
}

export function elysiaApp() {
    const app = new Elysia();
    for (const [method, path] of ROUTES) app.route(method, path, text(path));
    // Elysia は最初のリクエストの前に、ルートからコードを生成して最適化する(aot)
    app.compile();
    return { name: "elysia", fetch: (req: Request) => app.handle(req) };
}

export const APPS = [senriApp, honoApp, elysiaApp];
