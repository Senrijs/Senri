import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { EXPLANATIONS, explain, explainText } from "../../src/dev/explain.ts";
import { fill, hintCode, hintText, PAGE_MESSAGES } from "../../src/dev/messages.ts";
import { hintFor } from "../../src/dev/hints.ts";
import { SERVER_MESSAGES } from "../../src/dev/server-messages.ts";
import { senriError } from "../../src/errors.ts";
import { isLang, requestLang, terminalLang } from "../../src/lang.ts";
import { serve } from "../../adapters/serve/index.ts";
import { SERVE_MESSAGES } from "../../adapters/serve/messages.ts";

const html = { accept: "text/html" };
const req = (path: string, headers: Record<string, string> = {}) => new Request(`http://localhost${path}`, { headers });
// localhost からのアクセス(Bun の server を真似る)。ダッシュボードはこのときだけ開く
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) };
const dashboardReq = (path: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3927${path}`, { headers: { host: "localhost:3927", ...headers } });
// コメントを除いて、日本語のある行の番号(1 から)を返す
// 文字列とテンプレートの中は飛ばすので、"/*" のような文字列をコメントの始まりと間違えない
// 正規表現のリテラルは見分けないが、\ の次の文字は飛ばすので /^https?:\/\// も読み違えない
function japaneseLines(source: string): number[] {
    const text = source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
    let code = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        const next = text[i + 1];
        if (ch === "/" && next === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            code += "\n";
        } else if (ch === "/" && next === "*") {
            const end = text.indexOf("*/", i + 2);
            const stop = end === -1 ? text.length : end + 2;
            code += text.slice(i, stop).replace(/[^\n]/g, " ");
            i = stop - 1;
        } else if (ch === '"' || ch === "'" || ch === "`") {
            // 文字列は、閉じるまでそのまま残す(' と " は行末で終わりにする)
            let j = i + 1;
            while (j < text.length && text[j] !== ch && (ch === "`" || text[j] !== "\n")) j += text[j] === "\\" ? 2 : 1;
            code += text.slice(i, j + 1);
            i = j;
        } else if (ch === "\\") {
            code += text.slice(i, i + 2);
            i++;
        } else {
            code += ch;
        }
    }
    return code.split("\n").flatMap((line, i) => (/[ぁ-んァ-ヶ一-龥]/.test(line) ? [i + 1] : []));
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function dataOf(body: string) {
    const m = /<script type="application\/json" id="senri-data">([\s\S]*?)<\/script>/.exec(body);
    return JSON.parse(m![1]!) as { lang: string; warnings?: string[]; hint?: { key: string }; suggestion?: { note: string } };
}

// スクリプトが動かないときの簡易表示(ページのスクリプトには両方の言語の辞書が入っているので、ここで比べる)
const fallbackOf = (body: string) => /<div id="app">([\s\S]*?)<\/main>/.exec(body)![1]!;

function boomApp(options?: Parameters<typeof devtools>[0]) {
    const app = createApp({ dev: devtools(options) });
    app.get("/boom", () => {
        throw new Error("x");
    });
    app.get("/hello", () => "hi");
    return app;
}

describe("辞書", () => {
    test.each([
        ["画面", PAGE_MESSAGES],
        ["サーバー", SERVER_MESSAGES],
        ["エラーの説明", EXPLANATIONS],
        ["serve()", SERVE_MESSAGES],
    ] as [string, Record<"en" | "ja", Record<string, string>>][])("%s: キーが両方の言語にある", (_, dictionary) => {
        expect(Object.keys(dictionary.ja).sort()).toEqual(Object.keys(dictionary.en).sort());
    });

    test.each([
        ["画面", PAGE_MESSAGES],
        ["サーバー", SERVER_MESSAGES],
        ["serve()", SERVE_MESSAGES],
    ] as [string, Record<"en" | "ja", Record<string, string>>][])("%s: 差し込む値が両方の言語で同じ。英語に日本語が混ざらない", (_, dictionary) => {
        for (const [key, text] of Object.entries(dictionary.en)) {
            expect([key, placeholders(dictionary.ja[key]!)]).toEqual([key, placeholders(text)]);
            expect([key, /[ぁ-んァ-ヶ一-龥]/.test(text)]).toEqual([key, false]);
        }
    });

    test("エラーの説明: 英語に日本語が混ざらない", () => {
        for (const [key, text] of Object.entries(EXPLANATIONS.en)) {
            expect([key, /[ぁ-んァ-ヶ一-龥]/.test(text)]).toEqual([key, false]);
        }
    });

    test("fill は1回だけ置き換える。値の中の {name} や $ はそのまま", () => {
        expect(fill("{a} {b}", { a: "{b}", b: "$&" })).toBe("{b} $&");
        expect(fill("{ devtools } {nope}", {})).toBe("{ devtools } {nope}");
    });

    test("コメントを除くとき、文字列の中の /* や // はコメントとみなさない", () => {
        const source = [
            'if (path.endsWith("/*")) x(); // 日本語のコメント',
            'const a = "日本語の文字列";',
            "/* 日本語の",
            "   コメント */ const b = /^https?:\\/\\//.test(u) ? '日本語' : `${c}日本語`;",
            '<!-- 日本語 --><p>日本語</p>',
        ].join("\n");

        expect(japaneseLines(source)).toEqual([2, 4, 5]);
    });

    // 辞書の外に日本語を書くと、その文言は英語にならない(本番でも出るメッセージも、英語にそろえる)
    test("src/ と adapters/ と画面に、辞書の外の日本語がない", () => {
        const root = join(import.meta.dir, "../..");
        const allowed = [
            "src/dev/messages.ts",
            "src/dev/server-messages.ts",
            "src/dev/explain.ts",
            "src/dev/page.generated.ts",
            "adapters/serve/messages.ts",
            "ui/src/sample.ts",
        ];
        const walk = (dir: string): string[] =>
            readdirSync(dir).flatMap((name) => {
                const path = join(dir, name);
                return statSync(path).isDirectory() ? walk(path) : [path];
            });
        const found: string[] = [];
        for (const file of ["src", "adapters", "ui/src"].flatMap((dir) => walk(join(root, dir)))) {
            const relative = file.slice(root.length + 1).replaceAll("\\", "/");
            if (allowed.includes(relative) || !/\.(ts|vue)$/.test(file)) continue;
            const text = readFileSync(file, "utf8");
            const lines = text.split("\n");
            for (const n of japaneseLines(text)) found.push(`${relative}:${n}: ${lines[n - 1]!.trim()}`);
        }
        expect(found).toEqual([]);
    });
});

describe("画面の言語(Accept-Language)", () => {
    test.each([
        ["ja", "ja"],
        ["ja-JP,ja;q=0.9,en;q=0.8", "ja"],
        ["en-US,en;q=0.9,ja;q=0.8", "en"],
        ["fr, ja;q=0.5", "ja"],
        ["JA-jp", "ja"],
        ["fr", "en"],
        ["*", "en"],
        ["", "en"],
        ["ja;q=0", "en"],
    ])("%j → %s", (header, expected) => {
        expect(requestLang(req("/", { "accept-language": header }))).toBe(expected as "ja");
    });

    test("ヘッダーがなければ英語", () => {
        expect(requestLang(req("/"))).toBe("en");
    });

    test("エラーページが切り替わる。html の lang も", async () => {
        const app = boomApp();
        const ja = await (await app.fetch(req("/boom", { ...html, "accept-language": "ja" }))).text();
        const en = await (await app.fetch(req("/boom", { ...html, "accept-language": "en" }))).text();

        expect(dataOf(ja).lang).toBe("ja");
        expect(ja).toContain('<html lang="ja">');
        expect(fallbackOf(ja)).toContain("このページの詳しい表示には");
        expect(dataOf(en).lang).toBe("en");
        expect(en).toContain('<html lang="en">');
        expect(fallbackOf(en)).toContain("This page needs JavaScript");
        expect(fallbackOf(en)).not.toContain("このページの詳しい表示には");
    });

    test("404 ページが切り替わる", async () => {
        const app = boomApp();
        const ja = await (await app.fetch(req("/helo", { ...html, "accept-language": "ja" }))).text();
        const en = await (await app.fetch(req("/helo", { ...html, "accept-language": "en" }))).text();

        expect(fallbackOf(ja)).toContain("は見つかりませんでした");
        expect(fallbackOf(ja)).toContain("もしかして: GET /hello");
        expect(dataOf(ja).suggestion!.note).toBe('"l" が1文字足りません');
        expect(fallbackOf(en)).toContain("was not found");
        expect(fallbackOf(en)).toContain("did you mean: GET /hello");
        expect(fallbackOf(en)).not.toContain("は見つかりませんでした");
        expect(dataOf(en).suggestion!.note).toBe('Missing 1 character(s): "l"');
    });

    test.each([[undefined], ["fr"]])("Accept-Language が %j のエラーページと 404 ページは英語", async (language) => {
        const app = boomApp();
        const headers = { ...html, ...(language ? { "accept-language": language } : {}) };

        expect(dataOf(await (await app.fetch(req("/boom", headers))).text()).lang).toBe("en");
        expect(dataOf(await (await app.fetch(req("/helo", headers))).text()).lang).toBe("en");
    });

    test("テキストのレスポンスも切り替わる", async () => {
        const app = boomApp();

        expect(await (await app.fetch(req("/helo", { "accept-language": "ja" }))).text()).toBe("404 Not Found: GET /helo\nもしかして: GET /hello ?");
        expect(await (await app.fetch(req("/helo"))).text()).toBe("404 Not Found: GET /helo\nDid you mean: GET /hello ?");

        const posted = new Request("http://localhost/hello", { method: "POST" });
        expect(await (await app.fetch(posted)).text()).toBe("405 Method Not Allowed: POST /hello\nAllowed: GET, HEAD, OPTIONS");
    });

    test("Vary: 言語で変えた応答にだけ Accept-Language を足す。ほかの Vary は残す", async () => {
        const app = boomApp();
        app.use(async (c, next) => {
            const res = await next();
            const headers = new Headers(res.headers);
            headers.set("vary", "Origin");
            return new Response(res.body, { status: res.status, headers });
        });

        expect((await app.fetch(req("/hello"))).headers.get("vary")).toBe("Origin");
        expect((await app.fetch(req("/helo"))).headers.get("vary")).toBe("Origin, Accept-Language");
        expect((await app.fetch(req("/boom", html))).headers.get("vary")).toBe("Origin, Accept-Language");
    });
});

describe("ダッシュボード", () => {
    const warned = () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        const app = createApp({ dev: devtools() });
        app.use("/admni", async (_, next) => next());
        app.get("/admin", () => "ok");
        return { app, restore: () => warn.mockRestore() };
    };

    test("ページと警告が切り替わる", async () => {
        const { app, restore } = warned();
        try {
            const ja = await (await app.fetch(dashboardReq("/_senri", { "accept-language": "ja" }), local)).text();
            const en = await (await app.fetch(dashboardReq("/_senri"), local)).text();

            expect(dataOf(ja).lang).toBe("ja");
            expect(ja).toContain('<html lang="ja">');
            expect(dataOf(ja).warnings![0]).toContain("打ち間違いではありませんか");
            expect(dataOf(en).lang).toBe("en");
            expect(dataOf(en).warnings![0]).toContain('Did you mean "/admin"?');
        } finally {
            restore();
        }
    });

    test.each([[undefined], ["fr"]])("Accept-Language が %j なら英語", async (language) => {
        const { app, restore } = warned();
        try {
            const res = await app.fetch(dashboardReq("/_senri", language ? { "accept-language": language } : {}), local);
            expect(dataOf(await res.text()).lang).toBe("en");
        } finally {
            restore();
        }
    });

    test("記録したエラーページは、見ている人の言語で出す。ヒントはキーで持つ", async () => {
        const app = boomApp();
        await app.fetch(req("/boom", { "accept-language": "en" }));
        const url = "/_senri/api/requests/1/error";
        const ja = await (await app.fetch(dashboardReq(url, { "accept-language": "ja" }), local)).text();
        const en = await (await app.fetch(dashboardReq(url, { "accept-language": "en" }), local)).text();

        expect(dataOf(ja).lang).toBe("ja");
        expect(dataOf(ja).hint!.key).toBe("hint.uncaught");
        expect(fallbackOf(ja)).toContain("このページの詳しい表示には");
        expect(dataOf(en).lang).toBe("en");
        expect(fallbackOf(en)).toContain("This page needs JavaScript");
    });

    test("ヒントの文と例は、表示するときに言語を選べる", () => {
        const hint = hintFor(new SyntaxError("Unexpected token in JSON at position 1"))!;

        expect(hintText(hint, "ja")).toContain("JSON として読めませんでした");
        expect(hintText(hint, "en")).toContain("could not be read as JSON");
        expect(hintCode(hint, "ja")).toContain("JSON が正しくありません");
        expect(hintCode(hint, "en")).toContain("Invalid JSON");
    });
});

describe("ターミナルの言語", () => {
    const envOf = (values: Record<string, string>) => (name: string) => values[name];
    const noLocale = () => "";

    test.each([
        [{ LANG: "ja_JP.UTF-8" }, "ja"],
        [{ LANG: "ja" }, "ja"],
        [{ LANG: "ja_JP.eucJP@euro" }, "ja"],
        [{ LANG: "en_US.UTF-8" }, "en"],
        [{ LANG: "fr_FR.UTF-8" }, "en"],
        [{ LANG: "C" }, "en"],
        [{ LANG: "C.UTF-8" }, "en"],
        [{ LANG: "POSIX" }, "en"],
        [{ LC_MESSAGES: "ja_JP.UTF-8", LANG: "en_US.UTF-8" }, "ja"],
        [{ LC_ALL: "ja_JP.UTF-8", LC_MESSAGES: "en_US", LANG: "en_US" }, "ja"],
        [{ LC_ALL: "C", LANG: "ja_JP.UTF-8" }, "en"],
        [{ LC_ALL: "", LANG: "ja_JP.UTF-8" }, "ja"],
    ])("%j → %s", (values, expected) => {
        expect(terminalLang(envOf(values), () => "en-US")).toBe(expected as "ja");
    });

    test("環境変数がなければ OS のロケールを見る。読めなければ英語", () => {
        expect(terminalLang(envOf({}), () => "ja-JP")).toBe("ja");
        expect(terminalLang(envOf({}), () => "en-GB")).toBe("en");
        expect(terminalLang(envOf({}), noLocale)).toBe("en");
    });

    test("環境変数があれば OS のロケールは見ない", () => {
        expect(terminalLang(envOf({ LANG: "C" }), () => "ja-JP")).toBe("en");
    });

    describe("実際の出力", () => {
        const saved = { LC_ALL: process.env.LC_ALL, LC_MESSAGES: process.env.LC_MESSAGES, LANG: process.env.LANG, NODE_ENV: process.env.NODE_ENV };
        afterEach(() => {
            for (const [name, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        });
        const setLang = (value: string) => {
            delete process.env.LC_ALL;
            delete process.env.LC_MESSAGES;
            process.env.LANG = value;
        };

        async function warningsOf(options?: Parameters<typeof devtools>[0]) {
            const warn = spyOn(console, "warn").mockImplementation(() => {});
            try {
                const app = createApp({ dev: devtools(options) });
                app.use("/admni", async (_, next) => next());
                app.get("/admin", () => "ok");
                await app.fetch(req("/admin"));
                return warn.mock.calls.map((args) => String(args[0]));
            } finally {
                warn.mockRestore();
            }
        }

        test("LANG で警告が切り替わる。1つの言語だけ出す", async () => {
            setLang("ja_JP.UTF-8");
            const ja = await warningsOf();
            setLang("en_US.UTF-8");
            const en = await warningsOf();

            expect(ja).toEqual(['[senri] "/admni" のミドルウェア(anonymous#1)は、どのルートにも当たりません。"/admin" の打ち間違いではありませんか？ルートなしで自分で返すミドルウェアなら、問題ありません']);
            expect(en).toEqual(['[senri] Middleware "anonymous#1" at "/admni" matches no route. Did you mean "/admin"? Ignore this if it answers by itself.']);
        });

        test("LANG=C なら英語", async () => {
            setLang("C");
            expect((await warningsOf())[0]).toContain("matches no route");
        });

        test("localhost だけにしているときの案内も切り替わる", async () => {
            delete process.env.NODE_ENV;
            setLang("ja_JP.UTF-8");
            const run = async () => {
                const warn = spyOn(console, "warn").mockImplementation(() => {});
                try {
                    const app = createApp({ dev: devtools() });
                    app.get("/", () => "ok");
                    await app.fetch(new Request("http://example.com/"));
                    return String(warn.mock.calls[0]?.[0]);
                } finally {
                    warn.mockRestore();
                }
            };

            expect(await run()).toContain("localhost へのリクエストだけ");
            setLang("en_US");
            expect(await run()).toContain("only for requests to localhost");
        });

        test("登録時のエラーの説明が切り替わる", () => {
            const message = () => {
                const app = createApp({ dev: devtools() });
                app.get("/a", () => "x");
                try {
                    app.get("/a", () => "y");
                } catch (err) {
                    return (err as Error).message;
                }
                return "";
            };

            setLang("ja_JP.UTF-8");
            expect(message()).toContain("すでに登録されています");
            setLang("en_US");
            expect(message()).toContain("is already registered");
        });

        test("serve() の案内が切り替わる。lang が優先", async () => {
            const log = spyOn(console, "log").mockImplementation(() => {});
            const app = createApp();
            try {
                const printed = async (options: Parameters<typeof serve>[1]) => {
                    log.mockClear();
                    const server = await serve(app, { port: 0, gracefulShutdown: false, ...options });
                    await server.stop();
                    return log.mock.calls.map((args) => String(args[0])).join("\n");
                };

                setLang("ja_JP.UTF-8");
                expect(await printed({})).toContain("port オプション");
                expect(await printed({ lang: "en" })).toContain("port option");
                setLang("en_US");
                expect(await printed({})).toContain("port option");
                expect(await printed({ lang: "ja" })).toContain("port オプション");
            } finally {
                log.mockRestore();
            }
        });

        test("設定で固定すると、環境変数より優先する", async () => {
            setLang("en_US");
            expect((await warningsOf({ lang: "ja" }))[0]).toContain("どのルートにも当たりません");
            setLang("ja_JP.UTF-8");
            expect((await warningsOf({ lang: "en" }))[0]).toContain("matches no route");
        });
    });
});

describe("devtools({ lang })", () => {
    test("Accept-Language より優先する。Vary は付けない", async () => {
        const ja = boomApp({ lang: "ja" });
        const en = boomApp({ lang: "en" });

        const page = await ja.fetch(req("/boom", { ...html, "accept-language": "en" }));
        expect(dataOf(await page.text()).lang).toBe("ja");
        expect(page.headers.get("vary")).toBeNull();
        expect(dataOf(await (await en.fetch(req("/boom", { ...html, "accept-language": "ja" }))).text()).lang).toBe("en");

        const notFound = await ja.fetch(req("/helo", { "accept-language": "en" }));
        expect(await notFound.text()).toContain("もしかして");
        expect(notFound.headers.get("vary")).toBeNull();
    });

    test("ダッシュボードでも優先する", async () => {
        const app = boomApp({ lang: "ja" });
        expect(dataOf(await (await app.fetch(dashboardReq("/_senri", { "accept-language": "en" }), local)).text()).lang).toBe("ja");
    });

    test("ja と en 以外なら投げる", () => {
        expect(() => devtools({ lang: "fr" as "ja" })).toThrow('devtools(): lang must be "ja" or "en"');
        expect(isLang("ja")).toBe(true);
        expect(isLang("fr")).toBe(false);
    });

    test("serve() も ja と en 以外なら拒否する", async () => {
        await expect(serve(createApp(), { lang: "fr" as "ja" })).rejects.toThrow('serve(): lang must be "ja" or "en"');
    });
});

describe("エラーの説明", () => {
    test("言語を選べる。本番の短い英語はそのまま残る", () => {
        const err = senriError("next_twice", "next() was called twice");

        expect(explainText(err, "ja")).toContain("2回呼ばれました");
        expect(explainText(err, "en")).toContain("called twice");
        explain(err, "en");
        expect(err.message).toBe("next() was called twice. One middleware can call it only once\nnext() was called twice");
    });

    test("同じエラーに2回付けない(別の言語でも)", () => {
        const err = senriError("next_twice", "short");
        explain(err, "ja");
        const once = err.message;
        explain(err, "en");

        expect(err.message).toBe(once);
    });
});
