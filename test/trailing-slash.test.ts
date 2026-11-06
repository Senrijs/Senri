import { describe, expect, test } from "bun:test";
import { createApp, trailingSlash, type TrailingSlashOptions } from "../src/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf } from "./bundle.ts";

function makeApp(options?: TrailingSlashOptions) {
    const app = createApp();
    app.use(trailingSlash(options));
    app.get("/", () => "root");
    app.get("/about", () => "about");
    app.get("/a/b", () => "ab");
    app.get("/users/:id", ({ id }) => id);
    app.get("/sitemap.xml", () => "xml");
    app.get("/v1.2/docs", () => "docs");
    app.get("/files/*", () => "files");
    app.post("/about", () => "posted");
    return app;
}

const go = (app: ReturnType<typeof makeApp>, path: string, method = "GET") => app.fetch(new Request(`http://localhost${path}`, { method }));
const where = async (app: ReturnType<typeof makeApp>, path: string, method = "GET") => {
    const res = await go(app, path, method);
    return [res.status, res.headers.get("location")];
};

describe('trailingSlash({ mode: "remove" })', () => {
    test("末尾のスラッシュを外す", async () => {
        const app = makeApp();

        expect(await where(app, "/about/")).toEqual([301, "/about"]);
        expect(await where(app, "/a/b/")).toEqual([301, "/a/b"]);
        expect(await where(app, "/users/42/")).toEqual([301, "/users/42"]);
        expect(await where(app, "/about//")).toEqual([301, "/about"]);
    });

    test("もう正規の形なら、そのまま", async () => {
        const res = await go(makeApp(), "/about");

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("about");
    });

    test("クエリを残す", async () => {
        expect(await where(makeApp(), "/about/?a=1&b=/x/")).toEqual([301, "/about?a=1&b=/x/"]);
    });

    test("エンコードされたパスは、そのまま残す", async () => {
        expect(await where(makeApp(), "/users/%E5%B1%B1%E7%94%B0/")).toEqual([301, "/users/%E5%B1%B1%E7%94%B0"]);
    });

    test("ルートの / はそのまま", async () => {
        expect((await go(makeApp(), "/")).status).toBe(200);
    });

    test("HEAD もリダイレクトする", async () => {
        expect(await where(makeApp(), "/about/", "HEAD")).toEqual([301, "/about"]);
    });

    test("GET / HEAD 以外はリダイレクトしない", async () => {
        const res = await go(makeApp(), "/about/", "POST");

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("posted");
    });

    test("ルートに一致しないパスは、そのまま 404", async () => {
        expect(await where(makeApp(), "/nope/")).toEqual([404, null]);
    });

    test("ワイルドカードのルートでも外す", async () => {
        expect(await where(makeApp(), "/files/a/")).toEqual([301, "/files/a"]);
    });

    test("// で始まるパスは、別のサイトに飛ばさない", async () => {
        const app = createApp();
        app.use(trailingSlash());
        app.get("/evil.com", () => "ok");

        for (const path of ["//evil.com/", "///evil.com/"]) {
            const res = await app.fetch(new Request(`http://localhost${path}`));

            expect(res.status).toBe(200);
            expect(res.headers.get("location")).toBeNull();
        }
    });
});

describe('trailingSlash({ mode: "add" })', () => {
    const add = () => makeApp({ mode: "add" });

    test("末尾にスラッシュを付ける。クエリを残す", async () => {
        expect(await where(add(), "/about")).toEqual([301, "/about/"]);
        expect(await where(add(), "/a/b?x=1")).toEqual([301, "/a/b/?x=1"]);
    });

    test("もう正規の形なら、そのまま", async () => {
        expect((await go(add(), "/about/")).status).toBe(200);
        expect((await go(add(), "/")).status).toBe(200);
    });

    test("最後のセグメントに . があれば、そのまま", async () => {
        expect((await go(add(), "/sitemap.xml")).status).toBe(200);
    });

    test("途中のセグメントの . は関係ない", async () => {
        expect(await where(add(), "/v1.2/docs")).toEqual([301, "/v1.2/docs/"]);
    });

    test("ルートに一致しないパスは、そのまま 404", async () => {
        expect(await where(add(), "/nope")).toEqual([404, null]);
    });

    test("// で始まるパスは、そのまま", async () => {
        const app = createApp();
        app.use(trailingSlash({ mode: "add" }));
        app.get("/evil", () => "ok");

        expect((await app.fetch(new Request("http://localhost//evil"))).status).toBe(200);
    });
});

describe("trailingSlash() の設定", () => {
    test("status: 308", async () => {
        expect(await where(makeApp({ status: 308 }), "/about/")).toEqual([308, "/about"]);
    });

    test("リダイレクトでは、ハンドラーを動かさない", async () => {
        let called = false;
        const app = createApp();
        app.use(trailingSlash());
        app.get("/x", () => {
            called = true;
            return "x";
        });
        await app.fetch(new Request("http://localhost/x/"));

        expect(called).toBe(false);
    });

    test.each([[{ mode: "both" }], [{ status: 302 }], [{ status: "301" }]])("不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            trailingSlash(options as TrailingSlashOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err)).toContain("trailingSlash()");
    });

    test("名前と印", () => {
        const middleware = trailingSlash();

        expect(middleware.name).toBe("trailingSlash");
        expect(isPlainSafe(middleware)).toBe(true);
    });

    test("使わなければ、本体に入らない", async () => {
        expect(await bundleOf("createApp")).not.toContain("trailing");
    });
});
