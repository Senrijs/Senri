// vite で見た目を確かめるときのサンプル(ビルド結果には入らない)
// ?page=notFound で404ページ、それ以外はエラーページ
import type { PageData } from "../../src/dev/page-data.ts";

const root = "C:/Users/me/senri";

export function sample(page: string | null): PageData {
    if (page === "notFound") {
        return {
            kind: "notFound",
            method: "GET",
            path: "/helo",
            suggestion: {
                method: "GET",
                path: "/hello",
                link: true,
                parts: [
                    { text: "/hel", mark: false },
                    { text: "l", mark: true },
                    { text: "o", mark: false },
                ],
                note: '"l" が1文字足りません',
            },
            routes: [
                ["GET", "/hello"],
                ["GET", "/ping"],
                ["GET", "/user"],
                ["POST", "/users"],
                ["GET", "/users/me"],
                ["GET", "/users/:id"],
                ["DELETE", "/users/:id"],
                ["GET", "/users/:id/posts/:postId"],
            ].map(([method, path]) => ({ method: method!, path: path!, link: method === "GET" && !path!.includes(":") })),
            dashboardUrl: "/_senri#requests/1",
        };
    }

    const file = `${root}/examples/shared/app.ts`;
    return {
        kind: "error",
        status: 500,
        statusText: "Internal Server Error",
        durationMs: 2.1,
        error: { name: "Error", message: "わざと壊した" },
        origin: null,
        location: { fn: "<anonymous>", file, display: "examples/shared/app.ts", line: 38, col: 15, kind: "user" },
        code: {
            file,
            line: 38,
            col: 15,
            lines: [
                { num: 35, code: 'app.get("/users/:id", ({ id }) => getUser(id));', hit: false },
                { num: 36, code: "", hit: false },
                { num: 37, code: 'app.get("/boom", () => {', hit: false },
                { num: 38, code: '    throw new Error("わざと壊した");', hit: true },
                { num: 39, code: "});", hit: false },
                { num: 40, code: "", hit: false },
                { num: 41, code: 'app.get("/admin", () => "ようこそ管理者さん");', hit: false },
            ],
            caret: "              ^^^^^^^^^^^^^^^^^^^^^^",
            label: "ここで throw",
        },
        hint: {
            text: "ハンドラーやミドルウェアで投げたエラーが、どこでもキャッチされませんでした。意図したエラーなら `HttpError` でステータスコードを指定できます。",
            code: 'throw new HttpError(400, "id が数字ではありません")',
        },
        frames: [
            { fn: "<anonymous>", file, display: "examples/shared/app.ts", line: 38, col: 15, kind: "user" },
            { fn: "getUser", file: `${root}/examples/shared/db.ts`, display: "examples/shared/db.ts", line: 12, col: 9, kind: "user" },
            ...["run", "handle", "step", "dispatch", "step", "dispatch"].map((fn, i) => ({
                fn,
                file: `${root}/src/compose.ts`,
                display: "src/compose.ts",
                line: 28 + i,
                col: 26,
                kind: "senri" as const,
            })),
        ],
        request: {
            method: "GET",
            path: "/boom",
            route: "/boom",
            params: {},
            userAgent: "Mozilla/5.0 (Windows NT 10.0)",
        },
        layers: [
            { name: "logger", self: 0.2, total: 2.1, failed: false },
            { name: "auth", self: 0.1, total: 1.9, failed: false },
            { name: "handler", self: 1.8, total: 1.8, failed: true },
        ],
        editor: { id: "vscode", detected: true },
        root,
        production: "500 Internal Server Error",
        dashboardUrl: "/_senri#requests/1",
    };
}
