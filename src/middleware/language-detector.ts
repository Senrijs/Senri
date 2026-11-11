// リクエストの言語を決める
import type { Middleware } from "../context.ts";
import { parseCookies } from "../cookie-header.ts";
import { senriError } from "../errors.ts";
import { headerOf, markPlainSafe, urlOf } from "../plain.ts";
import { appendVary, editable } from "./response.ts";

/** Where {@link languageDetector} looks for the language. */
export type LanguageSource = "querystring" | "cookie" | "header";

/** Options for {@link languageDetector}. */
export type LanguageDetectorOptions = {
    /** The languages the app supports, such as `["ja", "en"]`. `c.get("language")` is always one of these. */
    supportedLanguages: readonly string[];
    /** The language when nothing matches. Must be one of `supportedLanguages`. */
    fallbackLanguage: string;
    /** Where to look, in order. Default `["querystring", "cookie", "header"]`; the header is `Accept-Language`. */
    order?: readonly LanguageSource[];
    /** The query parameter. Default `"lang"`. */
    lookupQueryString?: string;
    /** The cookie name. Default `"language"`. */
    lookupCookie?: string;
};

/**
 * The variables set by {@link languageDetector}, for typing `c.get`.
 *
 * @example
 * ```ts
 * const app = createApp<LanguageVariables>();
 * app.get("/", (_, c) => c.get("language")); // string | undefined
 * ```
 */
export type LanguageVariables = {
    /** The language of this request. */
    language: string;
};

// 言語タグを、対応している言語に当てる。ja-JP → ja、zh-Hant-TW → zh-Hant → zh の順に短くして、最後に en → en-US も見る
// 開発モードのページの日英対応でも使う
export function matchLanguage(requested: string, supported: readonly string[]): string | null {
    const lower = requested.trim().toLowerCase();
    if (lower === "" || lower === "*") return null;
    const find = (tag: string) => supported.find((language) => language.toLowerCase() === tag);
    for (let tag = lower; tag !== ""; tag = tag.slice(0, Math.max(tag.lastIndexOf("-"), 0))) {
        const found = find(tag);
        if (found !== undefined) return found;
    }
    const primary = `${lower.split("-", 1)[0]!}-`;
    return supported.find((language) => language.toLowerCase().startsWith(primary)) ?? null;
}

// Accept-Language を q の順に並べる。q=0 と、読めない q のものは除く
export function parseAcceptLanguage(header: string): string[] {
    const items: { tag: string; q: number }[] = [];
    for (const part of header.split(",")) {
        const [tag, ...params] = part.split(";");
        const value = params.map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param)).find(Boolean)?.[1];
        const q = params.length === 0 ? 1 : Number(value ?? 0);
        if (q > 0) items.push({ tag: tag!.trim(), q });
    }
    // sort は安定なので、同じ q なら書いてある順
    return items.sort((a, b) => b.q - a.q).map((item) => item.tag);
}

// Accept-Language の中で、対応している言語に最初に当たったもの(q の順)。なければ null
export function matchAcceptLanguage(header: string, supported: readonly string[]): string | null {
    for (const tag of parseAcceptLanguage(header)) {
        const language = matchLanguage(tag, supported);
        if (language !== null) return language;
    }
    return null;
}

const SOURCES: readonly LanguageSource[] = ["querystring", "cookie", "header"];

/**
 * Middleware that decides the request's language and makes it available as `c.get("language")`. The result is always one of
 * `supportedLanguages`, so it is safe to use in a file path or in HTML. It sets no cookie: to remember a choice, set the
 * cookie named by `lookupCookie` yourself.
 *
 * - `ja-JP` matches `ja`, and `en` matches `en-US`. Case does not matter. `Accept-Language` is read in `q` order
 * - When it reads `Accept-Language`, it adds `Vary: Accept-Language`. It does not add `Vary: Cookie`, because that would
 *   stop most CDNs from caching: if a shared cache sits in front of pages that depend on the cookie, set it yourself
 *
 * Throws when `supportedLanguages` is empty, `fallbackLanguage` is not one of them, or another option is invalid.
 *
 * @example
 * ```ts
 * import { createApp, languageDetector, type LanguageVariables } from "@senrijs/senri";
 *
 * const app = createApp<LanguageVariables>();
 * app.use(languageDetector({ supportedLanguages: ["ja", "en"], fallbackLanguage: "en" }));
 * app.get("/", (_, c) => (c.get("language") === "ja" ? "こんにちは" : "Hello"));
 * ```
 */
export function languageDetector(options: LanguageDetectorOptions): Middleware {
    const { supportedLanguages: supported, fallbackLanguage: fallback } = options;
    const order = options.order ?? SOURCES;
    const query = options.lookupQueryString ?? "lang";
    const cookie = options.lookupCookie ?? "language";
    const valid =
        Array.isArray(supported) &&
        supported.length > 0 &&
        supported.every((language: unknown) => typeof language === "string" && language !== "") &&
        supported.includes(fallback) &&
        Array.isArray(order) &&
        order.every((source: LanguageSource) => SOURCES.includes(source)) &&
        typeof query === "string" &&
        query !== "" &&
        typeof cookie === "string" &&
        cookie !== "";
    if (!valid) throw senriError("language_detector_options", "languageDetector(): invalid options");

    return markPlainSafe<Middleware>(async function languageDetector(c, next) {
        let language: string | null = null;
        let readHeader = false;
        for (const source of order) {
            if (source === "querystring") {
                const url = urlOf(c);
                const at = url.indexOf("?");
                const value = at === -1 ? null : new URLSearchParams(url.slice(at + 1)).get(query);
                if (value !== null) language = matchLanguage(value, supported);
            } else if (source === "cookie") {
                const value = parseCookies(headerOf(c, "cookie"))[cookie];
                if (value !== undefined) language = matchLanguage(value, supported);
            } else {
                readHeader = true;
                const header = headerOf(c, "accept-language");
                if (header !== null) language = matchAcceptLanguage(header, supported);
            }
            if (language !== null) break;
        }
        c.set("language", language ?? fallback);
        if (!readHeader) return next();
        const res = editable(await next());
        appendVary(res.headers, "Accept-Language");
        return res;
    });
}
