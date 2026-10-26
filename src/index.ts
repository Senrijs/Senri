// @senrijs/senri の入口
import { createAppWith, type App, type AppOptions } from "./app.ts";

export * from "./common.ts";

// アプリを作る。dev: true のときだけ、開発用のモジュール(エラーページ・ダッシュボードなど)を読み込む
// 開発用のモジュールは import() で読み込むので、ファイルを分けるバンドラー(Vite など)では、本番のバンドルに入らない
export function createApp<V extends object = Record<string, unknown>>(options: AppOptions = {}): App<V> {
    return createAppWith<V>(options, () => import("./dev/index.ts"));
}
