// ブラウザ(ページと Service Worker)で動かすアプリ。どちらも同じルートを持つ
// createApp は、ページでも Service Worker でも @senrijs/senri のものを渡す
import type { App } from "../../src/index.ts";
import { otel } from "../../src/otel.ts";
import { fakeApi, recorded } from "../../examples/shared/otel-check.ts";
import { metrics, metricsHandler } from "../../src/metrics.ts";
import { problem } from "../../src/problem.ts";
import { checkJwtAlgorithms } from "../../examples/shared/jwt-check.ts";

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
    app.get("/api/page", (_, c) => c.html("<h1>こんにちは</h1>"));
    app.get("/api/go", (_, c) => c.redirect("/api/hello"));
    app.get("/api/go/japanese", (_, c) => c.redirect("/api/日本語"));
    app.get("/api/go/idn", (_, c) => c.redirect("https://例え.jp/パス"));
    app.get("/api/日本語", () => "日本語のルート");
    app.get("/api/item/nope", (_, c) => c.notFound());
    app.get("/api/wild/*", ({ "*": rest }) => `wild: ${rest}`);
    app.use("/api/otel", otel({ api: fakeApi, middlewareSpans: true }));
    app.get("/api/otel/:id", ({ id }) => `otel ${id}`);
    app.get("/api/otel-spans", () => recorded.splice(0).map((s) => `${s.name} < ${s.parent}`));
    app.use("/api/m", metrics());
    app.get("/api/m/:id", ({ id }) => `m ${id}`);
    app.get("/api/m-metrics", metricsHandler());
    app.get("/api/problem", (_, c) => problem(c, { status: 410, detail: "gone" }));
    app.get("/api/jwt", async () => (await checkJwtAlgorithms()).join(","));
    return app;
}
