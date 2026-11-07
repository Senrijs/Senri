import { describe, expect, test } from "bun:test";
import { createApp, createRouter } from "../src/index.ts";
import { devtools } from "../src/dev/index.ts";

const req = (path: string) => new Request(`http://localhost${path}`);

function errorOf(fn: () => void): (Error & { code?: string }) | undefined {
    try {
        fn();
    } catch (err) {
        return err as Error & { code?: string };
    }
    return undefined;
}

// 省略も検証もされず、その文字列ごと名前になっていたもの(":id{[0-9]+}" は /users/abc も通していた)
const INVALID: [string, string][] = [
    ["/users/:id?", "id?"],
    ["/:lang?/docs", "lang?"],
    ["/users/:id{[0-9]+}", "id{[0-9]+}"],
    ["/users/:id(\\d+)", "id(\\d+)"],
    ["/posts/:file{.+\\.png}", "file{.+\\.png}"],
    ["/:file{.:ext}", "file{.:ext}"],
    ["/:a-:b", "a-:b"],
    ["/:file.:ext", "file.:ext"],
    ["/:id+", "id+"],
    ["/:id[0-9]", "id[0-9]"],
    ["/:a|b", "a|b"],
    ["/: id", " id"],
];

describe("パラメーター名に使えない文字", () => {
    test.each(INVALID)("ルートの %s は param_name", (path, name) => {
        const error = errorOf(() => createApp().get(path, () => "x"));

        expect(error?.code).toBe("param_name");
        expect(error?.message).toBe(`Invalid parameter name: "${name}" in ${path}`);
    });

    test.each(INVALID)("ミドルウェアの %s も param_name", (path) => {
        expect(errorOf(() => createApp().use(path, (_c, next) => next()))?.code).toBe("param_name");
    });

    test("app.on、app.routes、createRouter でも同じ", () => {
        expect(errorOf(() => createApp().on("GET", "/:id?", () => "x"))?.code).toBe("param_name");
        expect(errorOf(() => createApp().routes({ "GET /:id?": () => "x" }))?.code).toBe("param_name");

        const router = createRouter("/r");
        router.get("/:id?", () => "x");
        expect(errorOf(() => createApp().route(router))?.code).toBe("param_name");

        const scoped = createRouter("/r");
        scoped.use("/:id?", (_c, next) => next());
        expect(errorOf(() => createApp().route(scoped))?.code).toBe("param_name");
    });

    test("開発モードでは、日本語の説明が付く", () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });

        expect(() => app.get("/users/:id?", () => "x")).toThrow("省略できるパラメーター");
    });

    test.each(["/users/:id", "/users/:user-id", "/users/:user_id", "/:名前", "/:$id", "/:file.png", "/12:00", "/v1:batch", "/users/:id/*"])(
        "%s は今までどおり登録できる",
        (path) => {
            expect(errorOf(() => createApp().get(path, () => "x"))).toBeUndefined();
        },
    );

    test("文字のセグメントは、今までどおり文字として比べる(開発モードの警告だけ)", async () => {
        const app = createApp();
        app.get("/[id]", () => "literal");

        expect((await app.fetch(req("/1"))).status).toBe(404);
        expect(await (await app.fetch(req("/[id]"))).text()).toBe("literal");
    });

    test("* を含むものは、今までどおり wildcard_position", () => {
        expect(errorOf(() => createApp().get("/:path(.*)", () => "x"))?.code).toBe("wildcard_position");
    });
});
