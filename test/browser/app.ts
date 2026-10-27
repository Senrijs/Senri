// ブラウザ(ページと Service Worker)で動かすアプリ。どちらも同じルートを持つ
// createApp はページでは @senrijs/senri、Service Worker では @senrijs/senri/tiny のものを渡す
import type { App } from "../../src/index.ts";

export function setup(app: App) {
    app.use(async (c, next) => {
        const res = await next();
        c.header("x-senri", "browser");
        return res;
    });
    app.get("/api/hello", () => "こんにちは");
    app.get("/api/users/:id", ({ id }) => ({ id, from: "senri" }));
    app.post("/api/echo", async (_, c) => ({ body: await c.body() }));
    app.get("/api/bytes", () => new Uint8Array([1, 2, 3]));
    return app;
}
