// 開発用の画面とターミナルの案内の言語を決める(devtools() と serve() が使う。本体の入口からは export しない)
import { matchAcceptLanguage, matchLanguage } from "./middleware/language-detector.ts";
import * as runtime from "./runtime.ts";

/** A language of the development pages and terminal messages. */
export type Lang = "ja" | "en";

const LANGS: readonly Lang[] = ["ja", "en"];

// 順番は POSIX のロケールの優先順位
const LOCALE_VARS = ["LC_ALL", "LC_MESSAGES", "LANG"];

export function isLang(value: unknown): value is Lang {
    return LANGS.includes(value as Lang);
}

// 画面の言語。Accept-Language がない・知らない言語のときは英語
export function requestLang(req: Request): Lang {
    const header = req.headers.get("accept-language");
    return ((header === null ? null : matchAcceptLanguage(header, LANGS)) as Lang | null) ?? "en";
}

// ターミナルの言語。最初に値があった環境変数で決める("C" や "POSIX" は英語)
// 環境変数がなければ OS のロケールを見る(Windows ではふつう LANG がない。Windows の Bun は OS の言語を返さないので英語になる)
export function terminalLang(
    env: (name: string) => string | undefined = runtime.env,
    locale: () => string = () => new Intl.DateTimeFormat().resolvedOptions().locale,
): Lang {
    const value = LOCALE_VARS.map(env).find(Boolean);
    // "ja_JP.UTF-8" → "ja-JP"
    const tag = value === undefined ? locale() : value.split(/[.@]/, 1)[0]!.replaceAll("_", "-");
    return (matchLanguage(tag, LANGS) as Lang | null) ?? "en";
}
