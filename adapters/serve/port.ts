// serve() のポートの決め方。公開しない部品(package.json / jsr.json の exports に載せない)
// 0.3.0 で、DEFAULT_PORT / PortSource / resolvePort を @senrijs/senri/serve から外した(意図せず公開していたもの)
// 中では serve() のほか、テスト・smoke のスクリプト・ドキュメントサイト(docs/website/scripts/home-data.ts)が読む
import * as runtime from "../../src/runtime.ts";

// よく使われる 3000 や 8080 とぶつかりにくい番号にしている
/** The port used when neither `port` nor the `PORT` environment variable is given. */
export const DEFAULT_PORT = 3927;

// - option: serve(app, { port }) で明示した
// - env: 環境変数 PORT(デプロイ先のサービスが決めることが多い)
// - default: どちらもなかった
/** Where the port came from: the `port` option, the `PORT` environment variable, or {@link DEFAULT_PORT}. */
export type PortSource = "option" | "env" | "default";

function isPort(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n <= 65535;
}

// 使うポートを決める: 明示した port → 環境変数 PORT → DEFAULT_PORT
// 環境変数は runtime.env で読むので、Deno で --allow-env がなければ聞き返さずにデフォルトになる
/**
 * Decides the port: `explicit`, then the `PORT` environment variable, then {@link DEFAULT_PORT}.
 * Throws a `RangeError` if `explicit` or `PORT` is not a port number (0 to 65535).
 *
 * @param env Reads an environment variable. Defaults to the runtime's; on Deno without permission to read `PORT`, it is treated as unset.
 */
export function resolvePort(
    explicit: number | undefined,
    env: (name: string) => string | undefined = runtime.env,
): { port: number; source: PortSource } {
    if (explicit !== undefined) {
        if (!isPort(explicit)) throw new RangeError(`port must be a port number (0-65535): ${explicit}`);
        return { port: explicit, source: "option" };
    }
    const raw = env("PORT")?.trim();
    if (raw) {
        // 黙ってデフォルトで待ち受けると、デプロイ先で「つながらない」原因が分かりにくいので、エラーにする
        const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!isPort(port)) throw new RangeError(`The PORT environment variable must be a port number (0-65535): ${raw}`);
        return { port, source: "env" };
    }
    return { port: DEFAULT_PORT, source: "default" };
}
