import { describe, expect, test } from "bun:test";
import { createApp, type AppOptions } from "../../src/index.ts";
import { PAGE_HTML } from "../../src/dev/page.generated.ts";
import type { NotFoundPageData } from "../../src/dev/page-data.ts";
import { devtools } from "../../src/dev/index.ts";

const html = { accept: "text/html,*/*;q=0.8" };
const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);

async function pageData(res: Response): Promise<NotFoundPageData> {
    const body = await res.text();
    const m = /<script type="application\/json" id="senri-data">([\s\S]*?)<\/script>/.exec(body);
    if (!m) throw new Error("404ページではありません:\n" + body.slice(0, 200));
    return JSON.parse(m[1]!);
}

function app(options: AppOptions = { dev: devtools() }) {
    const a = createApp(options);
    a.get("/users/:id", ({ id }) => id);
    a.get("/hello", () => "hi");
    a.post("/users", () => "created");
    a.delete("/users/:id", () => "deleted");
    return a;
}

describe("404ページ", () => {
    test("開発モード + Accept: text/html なら HTML", async () => {
        const res = await app().fetch(req("/helo", { headers: html }));

        expect(res.status).toBe(404);
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect((await pageData(res)).path).toBe("/helo");
    });

    test("「もしかして」と、どこが違うか。パラメーターのない GET はリンクにする", async () => {
        const data = await pageData(await app().fetch(req("/helo", { headers: html })));

        expect(data.suggestion).toEqual({
            method: "GET",
            path: "/hello",
            link: true,
            parts: [
                { text: "/hel", mark: false },
                { text: "l", mark: true },
                { text: "o", mark: false },
            ],
            note: '"l" が1文字足りません',
        });
    });

    test("候補にパラメーターがあればリンクにしない", async () => {
        const a = createApp({ dev: devtools() });
        a.get("/user/:id", () => "x");

        const data = await pageData(await a.fetch(req("/usr/:id", { headers: html })));

        expect(data.suggestion!.path).toBe("/user/:id");
        expect(data.suggestion!.link).toBe(false);
    });

    test("近いものがなければ「もしかして」はなし", async () => {
        const data = await pageData(await app().fetch(req("/totally/different/path", { headers: html })));

        expect(data.suggestion).toBeNull();
    });

    test("登録されているルートの一覧(パスの順)と、リンクにするか", async () => {
        const data = await pageData(await app().fetch(req("/nope", { headers: html })));

        expect(data.routes).toEqual([
            { method: "GET", path: "/hello", link: true },
            { method: "POST", path: "/users", link: false },
            { method: "DELETE", path: "/users/:id", link: false },
            { method: "GET", path: "/users/:id", link: false },
        ]);
    });

    test("all で登録したパラメーターのないルートも、GET で開けるのでリンクにする", async () => {
        const a = app();
        a.all("/health", () => "ok");

        const data = await pageData(await a.fetch(req("/healt", { headers: html })));

        expect(data.suggestion).toMatchObject({ method: "ALL", path: "/health", link: true });
        expect(data.routes.find((r) => r.path === "/health")!.link).toBe(true);
    });

    test("Accept が */* なら、今までどおりテキスト", async () => {
        const res = await app().fetch(req("/helo", { headers: { accept: "*/*" } }));

        expect(await res.text()).toBe("404 Not Found: GET /helo\nもしかして: GET /hello ?");
    });

    test("本番では、Accept: text/html でも固定の文言だけ", async () => {
        const res = await app({}).fetch(req("/helo", { headers: html }));

        expect(await res.text()).toBe("404 Not Found");
    });

    test("自分で notFound を書いたら、そちらが使われる", async () => {
        const a = app();
        a.notFound(() => "ないよ");

        expect(await (await a.fetch(req("/helo", { headers: html }))).text()).toBe("ないよ");
    });

    test("パスに <script> があっても、ページの script は増えない(XSS)", async () => {
        const res = await app().fetch(req("/%3C/script%3E%3Cscript%3Ealert(1)%3C/script%3E", { headers: html }));
        const body = await res.text();

        expect(body.split("<script").length).toBe(PAGE_HTML.split("<script").length);
    });

    test("スクリプトが動かなくても、パスと「もしかして」が HTML として入っている", async () => {
        const body = await (await app().fetch(req("/helo", { headers: html }))).text();
        const content = /<div id="app">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? "";

        expect(content).toContain("GET /helo");
        expect(content).toContain("GET /hello");
    });

    test("localhost から開いたときだけ、ダッシュボードへのリンクが付く", async () => {
        const local = { requestIP: () => ({ address: "127.0.0.1" }) };
        const r = () => new Request("http://localhost:3927/helo", { headers: { ...html, host: "localhost:3927" } });

        expect((await pageData(await app().fetch(r(), local))).dashboardUrl).toMatch(/^\/_senri#requests\/\d+$/);
        expect((await pageData(await app().fetch(r()))).dashboardUrl).toBeNull();
    });

    test("HEAD ではボディを返さない", async () => {
        const res = await app().fetch(req("/helo", { method: "HEAD", headers: html }));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("");
    });
});

describe("ワイルドカードのルート", () => {
    function withWildcard() {
        const a = createApp({ dev: devtools() });
        a.get("/files/*", () => "x");
        a.get("/hello", () => "hi");
        return a;
    }

    test("「もしかして」に出る。リンクにはしない", async () => {
        const a = withWildcard();

        expect(await (await a.fetch(req("/file/a"))).text()).toBe("404 Not Found: GET /file/a\nもしかして: GET /files/* ?");

        const data = await pageData(await a.fetch(req("/file/a", { headers: html })));
        expect(data.suggestion).toMatchObject({ method: "GET", path: "/files/*", link: false });
    });

    test("ルートの一覧でもリンクにしない", async () => {
        const data = await pageData(await withWildcard().fetch(req("/nope", { headers: html })));

        expect(data.routes).toEqual([
            { method: "GET", path: "/files/*", link: false },
            { method: "GET", path: "/hello", link: true },
        ]);
    });

    test("メソッドが違うときは 404 ページになる(405 にしない)", async () => {
        const res = await withWildcard().fetch(req("/files/a", { method: "POST" }));

        expect(res.status).toBe(404);
        expect(await res.text()).toContain("404 Not Found: POST /files/a");
    });

    test("/_senri の下には登録できない", () => {
        expect(() => withWildcard().get("/_senri/*", () => "x")).toThrow("予約");
    });

    test("開発モードの登録時のエラーには、日本語の説明が付く", () => {
        expect(() => withWildcard().get("/a/*/c", () => "x")).toThrow("最後のセグメント全体");
    });
});

describe("c.notFound() の 404", () => {
    // /hello に近いパスにルートを作って、c.notFound() を呼ぶ。提案があれば /hello が出るはずのパス
    function withNotFound(options?: AppOptions) {
        const a = app(options);
        a.get("/helo", (_, c) => c.notFound());
        a.use("/hallo", (c) => c.notFound());
        a.get("/hallo", () => "ここには来ない");
        return a;
    }

    test.each(["/helo", "/hallo"])("%s: ルートがあるので、HTML のページに「もしかして」は出ない", async (path) => {
        const res = await withNotFound().fetch(req(path, { headers: html }));
        const data = await pageData(res);

        expect(res.status).toBe(404);
        expect(data.kind).toBe("notFound");
        expect(data.path).toBe(path);
        expect(data.suggestion).toBeNull();
    });

    test.each(["/helo", "/hallo"])("%s: テキストにも「もしかして」は出ない", async (path) => {
        const res = await withNotFound().fetch(req(path));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe(`404 Not Found: GET ${path}`);
    });

    test("簡易表示にも「もしかして」は出ない", async () => {
        const body = await (await withNotFound().fetch(req("/helo", { headers: html }))).text();
        const content = /<div id="app">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? "";

        expect(content).toContain("GET /helo");
        expect(content).not.toContain("もしかして");
    });

    test("ルートがなければ、今までどおり「もしかして」が出る", async () => {
        const a = withNotFound();
        const text = await (await a.fetch(req("/hell"))).text();
        const data = await pageData(await a.fetch(req("/hell", { headers: html })));

        expect(text).toContain("もしかして");
        expect(data.suggestion).not.toBeNull();
    });

    test("ルートのないパスでミドルウェアが呼んだら、「もしかして」が出る", async () => {
        const a = app();
        a.use((c) => c.notFound());

        expect(await (await a.fetch(req("/helo"))).text()).toBe("404 Not Found: GET /helo\nもしかして: GET /hello ?");
    });

    test("HEAD ではボディを返さない", async () => {
        const res = await withNotFound().fetch(req("/helo", { method: "HEAD", headers: html }));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("");
    });

    test("自分で notFound を書いたら、そちらが使われる", async () => {
        const a = withNotFound();
        a.notFound(() => "ないよ");

        const res = await a.fetch(req("/helo", { headers: html }));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("ないよ");
    });

    test("本番では、固定の文言だけ", async () => {
        const res = await withNotFound({}).fetch(req("/helo", { headers: html }));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("404 Not Found");
    });

    describe.each(["/%E0%A4%A", "/a%2Fb"])("デコードできないパス %s", (path) => {
        const modes: [string, AppOptions][] = [
            ["本番", {}],
            ["開発モード", { dev: devtools() }],
        ];

        describe.each(modes)("%s", (_, options) => {
            test.each([
                ["テキスト", {}],
                ["HTML", html],
            ])("ミドルウェアが呼ぶと、固定の 404(%s)", async (_, headers) => {
                const a = app(options);
                a.use((c) => c.notFound());

                const res = await a.fetch(req(path, { headers }));

                expect(res.status).toBe(404);
                expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
                expect(await res.text()).toBe("404 Not Found");
            });

            test("HEAD でも 404", async () => {
                const a = app(options);
                a.use((c) => c.notFound());

                expect((await a.fetch(req(path, { method: "HEAD" }))).status).toBe(404);
            });

            test("c.header() のヘッダーも付く", async () => {
                const a = app(options);
                a.use((c) => {
                    c.header("x-mark", "1");
                    return c.notFound();
                });

                expect((await a.fetch(req(path))).headers.get("x-mark")).toBe("1");
            });

            test("c.notFound() を呼ばなければ、今までどおり 400", async () => {
                expect((await app(options).fetch(req(path))).status).toBe(400);
            });

            test("自分の notFound が c.path を読むと、今までどおり 400", async () => {
                const a = app(options);
                a.notFound((c) => `ありません: ${c.path}`);
                a.use((c) => c.notFound());

                expect((await a.fetch(req(path))).status).toBe(400);
            });
        });
    });
});
