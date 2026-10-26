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

// [名前, メソッド, パス, 当たるルート]。当たるルートが null なら 404
// ハンドラーはルートのパスをそのまま返すので、本文が当たるルートと一致するかで、正しく測れているかを確かめる
export const REQUESTS: [string, string, string, string | null][] = [
    ["static (short)", "GET", "/user", "/user"],
    ["static (same prefix)", "GET", "/user/comments", "/user/comments"],
    ["static (long)", "GET", "/very/deeply/nested/route/hello/there", "/very/deeply/nested/route/hello/there"],
    ["1 param", "GET", "/event/abcd1234", "/event/:id"],
    ["1 param + static", "GET", "/event/abcd1234/comments", "/event/:id/comments"],
    ["1 param (POST)", "POST", "/event/abcd1234/comment", "/event/:id/comment"],
    ["3 params", "GET", "/users/1/posts/2/comments/3", "/users/:id/posts/:postId/comments/:commentId"],
    ["not found", "GET", "/not/found/here", null],
];

// 期待どおりのレスポンスか。だめなら理由を返す
export async function checkResponse(res: Response, route: string | null): Promise<string | null> {
    const body = await res.text();
    if (route === null) return res.status === 404 ? null : `404 のはずが ${res.status}`;
    if (res.status !== 200) return `200 のはずが ${res.status}`;
    return body === route ? null : `本文が ${JSON.stringify(route)} ではなく ${JSON.stringify(body.slice(0, 60))}`;
}

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
