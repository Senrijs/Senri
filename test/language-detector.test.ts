import { describe, expect, test } from "bun:test";
import { createApp, languageDetector, type LanguageDetectorOptions, type LanguageVariables } from "../src/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { matchLanguage, parseAcceptLanguage } from "../src/middleware/language-detector.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf } from "./bundle.ts";

const BASE: LanguageDetectorOptions = { supportedLanguages: ["ja", "en", "zh-Hant", "pt-BR"], fallbackLanguage: "en" };

function appWith(options: LanguageDetectorOptions = BASE) {
    const app = createApp<LanguageVariables>();
    app.use(languageDetector(options));
    app.get("/", (_, c) => c.get("language") ?? "none");
    return app;
}

const go = (app: ReturnType<typeof appWith>, path = "/", headers: Record<string, string> = {}) => app.fetch(new Request(`http://localhost${path}`, { headers }));
const lang = async (app: ReturnType<typeof appWith>, path = "/", headers: Record<string, string> = {}) => (await go(app, path, headers)).text();

describe("matchLanguage()", () => {
    const supported = ["ja", "en-US", "zh-Hant", "zh"];

    test.each([
        ["ja", "ja"],
        ["JA", "ja"],
        ["ja-JP", "ja"],
        ["ja-JP-u-ca-japanese", "ja"],
        ["en", "en-US"],
        ["en-GB", "en-US"],
        ["en-us", "en-US"],
        ["zh-Hant-TW", "zh-Hant"],
        ["zh-Hans", "zh"],
        [" ja ", "ja"],
        ["fr", null],
        ["", null],
        ["*", null],
        ["j", null],
        ["jab", null],
    ])("%j → %j", (requested, expected) => {
        expect(matchLanguage(requested, supported)).toBe(expected);
    });
});

describe("parseAcceptLanguage()", () => {
    test.each([
        ["ja", ["ja"]],
        ["en;q=0.5, ja", ["ja", "en"]],
        ["fr;q=0.8, en;q=0.9, ja;q=0.1", ["en", "fr", "ja"]],
        ["en, ja", ["en", "ja"]],
        ["en ; q=0.5 , ja ; q=0.7", ["ja", "en"]],
        ["ja;q=0, en", ["en"]],
        ["ja;q=abc, en", ["en"]],
        ["*;q=0.5, ja", ["ja", "*"]],
        ["", []],
    ])("%j", (header, expected) => {
        expect(parseAcceptLanguage(header).filter(Boolean)).toEqual(expected);
    });
});

describe("languageDetector()", () => {
    test("何もなければ、既定の言語", async () => {
        expect(await lang(appWith())).toBe("en");
    });

    test("クエリ", async () => {
        expect(await lang(appWith(), "/?lang=ja")).toBe("ja");
        expect(await lang(appWith(), "/?a=1&lang=JA-jp")).toBe("ja");
    });

    test("Cookie", async () => {
        expect(await lang(appWith(), "/", { cookie: "a=1; language=ja" })).toBe("ja");
    });

    test("Accept-Language", async () => {
        expect(await lang(appWith(), "/", { "accept-language": "fr, ja;q=0.5, en;q=0.1" })).toBe("ja");
        expect(await lang(appWith(), "/", { "accept-language": "zh-Hant-TW" })).toBe("zh-Hant");
        expect(await lang(appWith(), "/", { "accept-language": "pt" })).toBe("pt-BR");
    });

    test("既定の順番: クエリ → Cookie → Accept-Language", async () => {
        const all = { cookie: "language=ja", "accept-language": "pt-BR" };

        expect(await lang(appWith(), "/?lang=zh-Hant", all)).toBe("zh-Hant");
        expect(await lang(appWith(), "/", all)).toBe("ja");
        expect(await lang(appWith(), "/", { "accept-language": "pt-BR" })).toBe("pt-BR");
    });

    test("対応していない値は、次を見る", async () => {
        const all = { cookie: "language=fr", "accept-language": "ja" };

        expect(await lang(appWith(), "/?lang=de", all)).toBe("ja");
    });

    test("order で変えられる。指定しないものは見ない", async () => {
        const options = { ...BASE, order: ["header", "querystring"] as const };

        expect(await lang(appWith(options), "/?lang=ja", { "accept-language": "pt" })).toBe("pt-BR");
        expect(await lang(appWith(options), "/?lang=ja")).toBe("ja");
        expect(await lang(appWith(options), "/", { cookie: "language=ja" })).toBe("en");
        expect(await lang(appWith({ ...BASE, order: [] }), "/?lang=ja")).toBe("en");
    });

    test("名前を変えられる", async () => {
        const options = { ...BASE, lookupQueryString: "hl", lookupCookie: "my-lang" };

        expect(await lang(appWith(options), "/?hl=ja&lang=pt")).toBe("ja");
        expect(await lang(appWith(options), "/", { cookie: "language=pt; my-lang=ja" })).toBe("ja");
    });

    test("対応している言語の表記で返す。任意の値は入らない", async () => {
        expect(await lang(appWith(), "/?lang=ZH-HANT")).toBe("zh-Hant");
        expect(await lang(appWith(), "/?lang=<script>")).toBe("en");
        expect(await lang(appWith(), "/?lang=../../etc")).toBe("en");
    });

    test("Accept-Language を読んだら Vary を付ける", async () => {
        const res = await go(appWith());

        expect(res.headers.get("vary")).toBe("Accept-Language");
    });

    test("その前に決まれば、Vary を付けない", async () => {
        expect((await go(appWith(), "/?lang=ja")).headers.get("vary")).toBeNull();
        expect((await go(appWith(), "/", { cookie: "language=ja" })).headers.get("vary")).toBeNull();
    });

    test("order に header がなければ、Vary を付けない", async () => {
        expect((await go(appWith({ ...BASE, order: ["querystring"] }))).headers.get("vary")).toBeNull();
    });

    test("既存の Vary に足す。エラーのレスポンスにも付く", async () => {
        const app = createApp();
        app.use(languageDetector(BASE));
        app.get("/", () => new Response("x", { headers: { vary: "Origin" } }));
        app.get("/boom", () => {
            throw new Error("boom");
        });

        expect((await app.fetch(new Request("http://localhost/"))).headers.get("vary")).toBe("Origin, Accept-Language");
        const boom = await app.fetch(new Request("http://localhost/boom"));
        expect(boom.status).toBe(500);
        expect(boom.headers.get("vary")).toBe("Accept-Language");
    });

    test("Cookie は書き込まない", async () => {
        expect((await go(appWith(), "/?lang=ja")).headers.getSetCookie()).toEqual([]);
    });

    test("c.get の型は string | undefined", () => {
        const app = createApp<LanguageVariables>();
        app.get("/", (_, c) => {
            const language: string | undefined = c.get("language");
            return language ?? "";
        });
    });

    test.each([
        [{}],
        [{ supportedLanguages: [], fallbackLanguage: "en" }],
        [{ supportedLanguages: "en", fallbackLanguage: "en" }],
        [{ supportedLanguages: ["ja"], fallbackLanguage: "en" }],
        [{ supportedLanguages: ["ja"] }],
        [{ supportedLanguages: [""], fallbackLanguage: "" }],
        [{ ...BASE, order: ["path"] }],
        [{ ...BASE, order: "header" }],
        [{ ...BASE, lookupQueryString: "" }],
        [{ ...BASE, lookupCookie: "" }],
    ])("不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            languageDetector(options as LanguageDetectorOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err, "ja")).toContain("languageDetector()");
    });

    test("名前と印", () => {
        const middleware = languageDetector(BASE);

        expect(middleware.name).toBe("languageDetector");
        expect(isPlainSafe(middleware)).toBe(true);
    });

    test("使わなければ、本体に入らない", async () => {
        expect((await bundleOf("createApp")).toLowerCase()).not.toContain("accept-language");
    });
});
