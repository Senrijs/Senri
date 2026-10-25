import { describe, expect, test } from "bun:test";
import { createApp, HttpError } from "../src/index.ts";
import { splitPath } from "../src/router.ts";

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

describe("パーセントエンコード", () => {
    test("日本語の静的ルートにマッチする", async () => {
        const app = createApp();
        app.get("/こんにちは", () => "ok");

        const res = await app.fetch(req("/こんにちは"));

        expect(res.status).toBe(200);
    });

    test("パスパラメーターはデコードされて届く", async () => {
        const app = createApp();
        app.get("/u/:name", ({ name }) => name);

        const res = await app.fetch(req("/u/山田"));

        expect(await res.text()).toBe("山田");
    });

    // どちらも、ルーターとミドルウェアで見え方が食い違う元になる
    const bad = [
        ["不正なエンコード", "/u/%E0%A4%A"],
        ["エンコードされた /", "/u/a%2Fb"],
    ];
    for (const [name, path] of bad) {
        test(`${name} (${path}) は 400`, async () => {
            const app = createApp();
            let called = false;
            app.get("/u/:name", () => {
                called = true;
                return "届いてはいけない";
            });

            const res = await app.fetch(req(path!));

            expect(res.status).toBe(400);
            expect(called).toBe(false);
        });
    }

    // %2E%2E は URL の仕様で ".." として先に解決される("/u/%2E%2E" → "/")ので、パラメーターには届かない
    for (const path of ["/u/%2E%2E", "/u/%2E"]) {
        test(`${path} はパラメーターとして届かない`, async () => {
            const app = createApp();
            let called = false;
            app.get("/u/:name", () => {
                called = true;
                return "届いてはいけない";
            });

            const res = await app.fetch(req(path));

            expect(res.status).toBe(404);
            expect(called).toBe(false);
        });
    }

    test("splitPath は念のため . と .. を 400 にする", () => {
        expect(() => splitPath("/u/..")).toThrow(HttpError);
        expect(() => splitPath("/u/.")).toThrow(HttpError);
        expect(splitPath("//a/b/")).toEqual(["a", "b"]);
    });
});
