// @senrijs/senri/tiny の入口。開発モード(エラーページ・ダッシュボードなど)を含まない
//
// @senrijs/senri の createApp は、開発用のモジュールを import() で読み込む。Vite のようにファイルを分けるバンドラーなら
// 本番のバンドルには入らないが、Cloudflare Workers(wrangler)や bun build のように1つのファイルにまとめるものでは、
// 使わない開発用のコードまで入ってしまう(約 150KB)。こちらは import() 自体がないので、入らない
// API は @senrijs/senri と同じ。dev: true を渡すとエラーになる
import { createAppWith, type App, type AppOptions } from "./app.ts";

export * from "./common.ts";

export function createApp<V extends object = Record<string, unknown>>(options: AppOptions = {}): App<V> {
    return createAppWith<V>(options, null);
}
