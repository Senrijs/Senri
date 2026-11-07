// serve() がターミナルに出す案内。en を元にして、ja は同じキーを必ず持つ
import type { Lang } from "../../src/lang.ts";

const en = {
    option: "port option",
    env: "PORT environment variable",
    default: "default; change it with the PORT environment variable",
    stopping: "Stopping (waiting for in-flight requests to finish)…",
};

const ja: Record<keyof typeof en, string> = {
    option: "port オプション",
    env: "環境変数 PORT",
    default: "デフォルト。環境変数 PORT で変えられます",
    stopping: "止めています(処理中のリクエストが終わるのを待ちます)…",
};

export const SERVE_MESSAGES: Record<Lang, Record<keyof typeof en, string>> = { en, ja };
