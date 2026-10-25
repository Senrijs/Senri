import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";

const req = (path: string, init?: RequestInit) =>
    new Request(`http://localhost${path}`, init);

describe("ルートの優先順位", () => {
    // 登録順をいろいろ変えても、静的なセグメントが優先されること
    const orders = [
        ["/users/:id", "/users", "/users/me"],
        ["/users", "/users/:id", "/users/me"],
        ["/users/me", "/users", "/users/:id"],
        ["/users/:id", "/users/:id/posts/:postId", "/users/me"],
    ];

    for (const order of orders) {
        test(`登録順 ${order.join(" → ")} でも /users/me は静的ルート`, async () => {
            const app = createApp();
            for (const path of order) {
                app.get(path, () => path);
            }

            const res = await app.fetch(req("/users/me"));

            expect(await res.text()).toBe("/users/me");
        });
    }

    test("前のセグメントが静的なほうが優先される", async () => {
        const app = createApp();
        app.get("/:a/b", () => "param-static");
        app.get("/a/:b", () => "static-param");

        const res = await app.fetch(req("/a/b"));

        expect(await res.text()).toBe("static-param");
    });
});
