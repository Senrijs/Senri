import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { applies, routeWarnings } from "../../src/dev/route-warnings.ts";
import type { DashboardPageData } from "../../src/dev/page-data.ts";

const route = (path: string, method = "GET") => ({ method, path });
const texts = (routes: string[], middlewares: string[] = []) =>
    routeWarnings(
        routes.map((p) => route(p)),
        middlewares.map((path) => ({ name: "auth", path })),
        "en",
    );

describe("どのルートにも当たらないミドルウェア", () => {
    test("打ち間違いなら、近いルートを提案する", () => {
        expect(texts(["/admin", "/admin/users"], ["/admni"])).toEqual([
            'Middleware "auth" at "/admni" matches no route. Did you mean "/admin"? Ignore this if it answers by itself.',
        ]);
    });

    test("ミドルウェアと同じ段数に切って比べる", () => {
        expect(texts(["/admin/users/list"], ["/admni"])[0]).toContain('Did you mean "/admin"?');
    });

    test("近いルートがなくても知らせる", () => {
        expect(texts(["/hello"], ["/zzzzzzzz"])).toEqual(['Middleware "auth" at "/zzzzzzzz" matches no route. Ignore this if it answers by itself.']);
    });

    test("日本語の説明も付く", () => {
        const [warning] = routeWarnings([route("/admin")], [{ name: "auth", path: "/admni" }], "ja");

        expect(warning).toBe('"/admni" のミドルウェア(auth)は、どのルートにも当たりません。"/admin" の打ち間違いではありませんか？ルートなしで自分で返すミドルウェアなら、問題ありません');
    });

    test.each([
        ["そのパス", ["/admin"], "/admin"],
        ["その下のルート", ["/admin/users"], "/admin"],
        ["ルートのパラメーター", ["/users/:id"], "/users/1"],
        ["ミドルウェアのパラメーター", ["/acme/admin"], "/:tenant/admin"],
        ["両方のパラメーター", ["/users/:id/posts"], "/users/:uid"],
        ["/files/* のルート", ["/files/*"], "/files/secret"],
        ["/:page のルート", ["/:page"], "/admni"],
    ])("%s に当たれば、警告しない", (_, routes, path) => {
        expect(texts(routes, [path])).toEqual([]);
    });

    test("パスのないミドルウェアと / のミドルウェアは、確かめない", () => {
        expect(routeWarnings([route("/a")], [{ name: "all", path: null }, { name: "root", path: "/" }], "en")).toEqual([]);
    });

    describe("/* があるとき", () => {
        test("近いルートがあれば、打ち間違いとして知らせる", () => {
            expect(texts(["/*", "/admin/users"], ["/admni"])[0]).toContain('Did you mean "/admin"?');
        });

        test("近いルートがなければ、知らせない(/* に当たっている可能性がある)", () => {
            expect(texts(["/*", "/hello"], ["/zzzzzzzz"])).toEqual([]);
            expect(texts(["/*"], ["/admni"])).toEqual([]);
        });

        test("/* のほかに当たるルートがあれば、知らせない", () => {
            expect(texts(["/*", "/admin/users"], ["/admin"])).toEqual([]);
        });
    });
});

describe("ほかのフレームワークの書き方に見えるパス", () => {
    test.each(["/a?", "/[a-z]", "/users/[id]", "/docs/[...slug]", "/a|b", "/{id}", "/(group)/a", "/files{.json}"])("%s は文字として比べると知らせる", (path) => {
        const [text] = texts([path]);

        expect(text).toStartWith(`Route "GET ${path}": "`);
        expect(text).toContain('is compared as literal text. Senri has no optional segments or patterns; use ":name" or "*".');
    });

    test(":file.png は、パラメーターの名前になると知らせる", () => {
        expect(texts(["/:file.png"])).toEqual([
            'Route "GET /:file.png": the parameter is named "file.png". Senri does not split a parameter at "."; check the value in the handler or with a schema.',
        ]);
    });

    test("ミドルウェアのパスも確かめる", () => {
        expect(texts(["/[id]/a"], ["/[id]"])).toEqual([
            'Route "GET /[id]/a": "[id]" is compared as literal text. Senri has no optional segments or patterns; use ":name" or "*".',
            'Middleware "auth" at "/[id]": "[id]" is compared as literal text. Senri has no optional segments or patterns; use ":name" or "*".',
        ]);
    });

    test.each(["/12:00", "/v1:batch", "/c++", "/a-b", "/a.b", "/users/:user-id", "/users/:user_id", "/files/*", "/:id", "/*", "/こんにちは"])("%s は知らせない", (path) => {
        expect(texts([path])).toEqual([]);
    });
});

test("applies: ミドルウェアのパラメーターは、どのセグメントにも合う", () => {
    expect(applies(["users", ":id"], ["users", "1"])).toBe("yes");
    expect(applies(["users", ":id"], ["users", ":uid"])).toBe("yes");
    expect(applies(["users", "1"], ["users", ":id"])).toBe("maybe");
    expect(applies(["users", ":id"], ["users"])).toBe("no");
    expect(applies(["users"], ["posts"])).toBe("no");
});

describe("コンソールへの警告", () => {
    const original = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = original;
    });

    const req = (url = "http://localhost/admin/users") => new Request(url);
    function mistaken() {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.use("/admni", function auth(_c, next) {
            return next();
        });
        app.get("/admin/users", () => "x");
        return app;
    }
    async function warnings(run: () => Promise<void>) {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            await run();
            return warn.mock.calls.map((c) => String(c[0]));
        } finally {
            warn.mockRestore();
        }
    }

    test("最初のリクエストで、1つの言語だけで出す", async () => {
        const app = mistaken();
        const out = await warnings(async () => {
            await app.fetch(req());
        });

        expect(out).toEqual([
            '[senri] "/admni" のミドルウェア(auth)は、どのルートにも当たりません。"/admin" の打ち間違いではありませんか？ルートなしで自分で返すミドルウェアなら、問題ありません',
        ]);
    });

    test("登録しただけでは出さない(ルートが出揃うのを待つ)", async () => {
        const out = await warnings(async () => {
            mistaken();
        });

        expect(out).toEqual([]);
    });

    test("同じ警告は1回だけ", async () => {
        const app = mistaken();
        const out = await warnings(async () => {
            for (let i = 0; i < 3; i++) await app.fetch(req());
        });

        expect(out).toHaveLength(1);
    });

    test("あとからルートを足すと確かめ直す。増えた分だけ出す", async () => {
        const app = mistaken();
        const out = await warnings(async () => {
            await app.fetch(req());
            app.get("/a?", () => "x");
            await app.fetch(req());
            await app.fetch(req());
        });

        expect(out).toHaveLength(2);
        expect(out[1]).toContain('Route "GET /a?"');
    });

    test("あとからルートを足して当たるようになれば、もう出さない", async () => {
        const app = mistaken();
        const out = await warnings(async () => {
            app.get("/admni/x", () => "x");
            await app.fetch(req());
        });

        expect(out).toEqual([]);
    });

    test("アプリごとに別々に出す", async () => {
        const out = await warnings(async () => {
            await mistaken().fetch(req());
            await mistaken().fetch(req());
        });

        expect(out).toHaveLength(2);
    });

    test("/_senri を最初に開いたときも出す", async () => {
        const app = mistaken();
        const out = await warnings(async () => {
            const res = await app.fetch(new Request("http://localhost:3927/_senri", { headers: { host: "localhost:3927" } }), { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) });
            await res.text();
        });

        expect(out).toHaveLength(1);
    });

    test("開発用の出力をしないリクエストでは出さない(localhost でない)", async () => {
        delete process.env.NODE_ENV;
        const app = mistaken();
        const out = await warnings(async () => {
            await app.fetch(new Request("http://example.com/admin/users"), { remoteAddr: { hostname: "127.0.0.1" } });
        });

        expect(out.filter((line) => line.includes("matches no route"))).toEqual([]);
    });

    test("NODE_ENV=production では出さない", async () => {
        process.env.NODE_ENV = "production";
        const app = mistaken();
        const out = await warnings(async () => {
            await app.fetch(req());
        });

        expect(out).toEqual([]);
    });

    test("問題がなければ出さない", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.use("/admin/*", (_c, next) => next());
        app.get("/admin/users", () => "x");
        const out = await warnings(async () => {
            await app.fetch(req());
        });

        expect(out).toEqual([]);
    });
});

describe("ダッシュボード", () => {
    const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
    async function pageData(app: ReturnType<typeof createApp>): Promise<DashboardPageData> {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            const body = await (await app.fetch(new Request("http://localhost:3927/_senri", { headers: { host: "localhost:3927" } }), local)).text();
            return JSON.parse(/id="senri-data">([\s\S]*?)<\/script>/.exec(body)![1]!);
        } finally {
            warn.mockRestore();
        }
    }

    test("warnings に日本語の説明が入る", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.use("/admni", function auth(_c, next) {
            return next();
        });
        app.get("/admin/users", () => "x");
        app.get("/a?", () => "x");

        expect((await pageData(app)).warnings).toEqual([
            'Route "GET /a?": "a?" は文字として比べます。Senri に省略できるセグメントやパターンはありません。":name" か "*" を使ってください',
            '"/admni" のミドルウェア(auth)は、どのルートにも当たりません。"/admin" の打ち間違いではありませんか？ルートなしで自分で返すミドルウェアなら、問題ありません',
        ]);
    });

    test("問題がなければ空", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.get("/hello", () => "hi");

        expect((await pageData(app)).warnings).toEqual([]);
    });

    test("パスに <script> があっても、ページの script は増えない", async () => {
        const app = createApp({ dev: devtools({ lang: "ja" }) });
        app.get("/</script><script>alert(1)</script>?", () => "x");
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            const body = await (await app.fetch(new Request("http://localhost:3927/_senri", { headers: { host: "localhost:3927" } }), local)).text();

            expect(body).not.toContain("<script>alert(1)");
        } finally {
            warn.mockRestore();
        }
    });
});
