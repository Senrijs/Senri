// ドキュメント(docs/website/content/docs/ja)に書いた「こうすると、こうなる」を確かめるテストの部品
//
// - claim(id, title, fn) で 1 つの主張を確かめる。id は "<ページ>#<名前>"(例: "routing/path-rules#405-allow")
//   ページは content/docs/ja からのパスで、拡張子を除いたもの(index.mdx は "index"、built-in/index.mdx は "built-in/index")
// - ページの側には、その主張のところに {/* verify: <名前> */} を置く(表示されない)
// - scripts/check-doc-claims.ts が、ページのしるしとテストの id が 1 対 1 で対応しているかを確かめる
//   (ページに主張を足してテストがない、テストを残したままページから主張を消した、のどちらも CI で落ちる)
// - id は文字列のまま書く(check-doc-claims.ts が、テストのファイルから claim("...") を読み取るため)
import { test } from "bun:test";

export function claim(id: string, title: string, fn: () => unknown, timeout?: number): void {
    test(`${id} ${title}`, fn as () => Promise<void>, timeout);
}

// 接続元(Bun の Server と同じ形)。localhost からのリクエストとして渡す
export const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
export const ipInfo = (address: string) => ({ requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 1 }) });

type FetchApp = { fetch(req: Request, info?: unknown): Response | Promise<Response> };
export type RequestOptions = RequestInit & { info?: unknown };

// app.fetch を呼ぶ。接続元は既定で localhost
export function req(app: FetchApp, method: string, path: string, init: RequestOptions = {}): Promise<Response> {
    const { info, ...rest } = init;
    return Promise.resolve(app.fetch(new Request(`http://localhost${path}`, { method, ...rest }), "info" in init ? info : local));
}

// console に出るもの(わざと起こしたエラーのログなど)を出さずに動かす
export async function quiet<T>(fn: () => T | Promise<T>): Promise<T> {
    const { error, warn, log } = console;
    console.error = console.warn = console.log = () => {};
    try {
        return await fn();
    } finally {
        Object.assign(console, { error, warn, log });
    }
}
