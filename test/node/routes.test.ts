// defineRoutes() / endpoint() の表が、Node のアダプター(Request を後で作る近道)でも同じに動くか
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp, defineRoutes, endpoint, secureHeaders, type Middleware } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";

async function listen(app: ReturnType<typeof createApp>) {
    const server = serve(app, { port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

describe("defineRoutes()(Node)", () => {
    test("ルートのミドルウェアとスキーマが、近道でも動く", async () => {
        const log: string[] = [];
        const auth: Middleware<{ user: string }> = async (c, next) => {
            log.push("auth");
            if (c.req.headers.get("authorization") !== "ok") {
                c.status(401);
                return "login";
            }
            c.set("user", "alice");
            await next();
        };
        const app = createApp();
        // 純正のミドルウェアだけのとき(近道が Response を作らない形)と同じ並びにする
        app.use(secureHeaders());
        app.routes(
            defineRoutes("/admin", { use: [auth] })({
                "GET /me": (_, c) => ({ user: c.get("user") }),
                "POST /names": endpoint(
                    { body: { "~standard": { version: 1, vendor: "t", validate: (value: unknown) => ({ value }) } } },
                    (_, c) => ({ got: c.valid("body") }),
                ),
            }),
        );
        app.get("/public", () => "p");
        const { url, close } = await listen(app);
        try {
            assert.equal((await fetch(`${url}/admin/me`)).status, 401);
            assert.deepEqual(await (await fetch(`${url}/admin/me`, { headers: { authorization: "ok" } })).json(), { user: "alice" });
            const posted = await fetch(`${url}/admin/names`, {
                method: "POST",
                headers: { authorization: "ok", "content-type": "application/json" },
                body: JSON.stringify({ a: 1 }),
            });
            assert.deepEqual(await posted.json(), { got: { a: 1 } });
            assert.equal(await (await fetch(`${url}/public`)).text(), "p");
            // /public では auth は動かない
            assert.deepEqual(log, ["auth", "auth", "auth"]);
        } finally {
            close();
        }
    });
});
