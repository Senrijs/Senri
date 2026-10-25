import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/index.ts";
import { PAGE_HTML } from "../../src/dev/page.generated.ts";
import type { NotFoundPageData } from "../../src/dev/page-data.ts";

const html = { accept: "text/html,*/*;q=0.8" };
const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);

async function pageData(res: Response): Promise<NotFoundPageData> {
    const body = await res.text();
    const m = /<script type="application\/json" id="senri-data">([\s\S]*?)<\/script>/.exec(body);
    if (!m) throw new Error("404ページではありません:\n" + body.slice(0, 200));
    return JSON.parse(m[1]!);
}

function app(options = { dev: true }) {
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
        const a = createApp({ dev: true });
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
        const res = await app({ dev: false }).fetch(req("/helo", { headers: html }));

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

    test("HEAD ではボディを返さない", async () => {
        const res = await app().fetch(req("/helo", { method: "HEAD", headers: html }));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("");
    });
});
