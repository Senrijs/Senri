// サーバーがページに埋め込むデータの形。サーバー(src/dev)と画面(ui/)の両方がこの型を使う
import type { ConversionOrigin } from "../errors.ts";
import type { CodeFrame } from "./source.ts";
import type { EditorGuess } from "./editor.ts";
import type { Hint } from "./hints.ts";
import type { FrameKind } from "./stack.ts";
import type { Difference } from "./suggest.ts";

export type PageFrame = {
    fn: string;
    // スラッシュ区切りの絶対パス(エディタで開く用)
    file: string;
    // 表示用。プロジェクトの中なら相対パス
    display: string;
    line: number;
    col: number;
    kind: FrameKind;
};

export type ErrorPageData = {
    kind: "error";
    status: number;
    statusText: string;
    // リクエスト全体にかかった時間(ミリ秒)。計測できなければ null
    durationMs: number | null;
    error: { name: string; message: string };
    // 返した値をレスポンスにする途中で失敗したとき、どこが返した値か(このときは location を出さない)
    origin: ConversionOrigin | null;
    // エラーが起きた、利用者のコードのいちばん上のフレーム
    location: PageFrame | null;
    code: CodeFrame | null;
    hint: Hint | null;
    frames: PageFrame[];
    request: {
        method: string;
        path: string;
        route: string | null;
        params: Record<string, string>;
        userAgent: string | null;
    };
    // ミドルウェアとハンドラーを通った順番(外側から)
    layers: { name: string; self: number; total: number; failed: boolean }[];
    editor: EditorGuess;
    // プロジェクトのルート(WebStorm で相対パスにするのに使う)
    root: string | null;
    // 本番(dev: false)で、このエラーのときに返る本文
    production: string;
    // ダッシュボードのこのリクエストへのリンク(localhost から開いたときだけ。開けなければ null)
    dashboardUrl: string | null;
};

export type NotFoundPageData = {
    kind: "notFound";
    method: string;
    path: string;
    suggestion: (Difference & { method: string; path: string; link: boolean }) | null;
    routes: { method: string; path: string; link: boolean }[];
    // ダッシュボードへのリンク(localhost から開いたときだけ)
    dashboardUrl: string | null;
};

// --- ダッシュボード(/_senri) ---

// 一覧に出す要約(詳細は /_senri/api/requests/:id で取る)
export type RequestSummary = {
    id: string;
    time: number;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    hasError: boolean;
};

// ルートのタブ。各ルートに、登録順でミドルウェアがかかるかどうか
// - yes: かかる / no: かからない / maybe: パスによる(":page" のようにパラメーターで決まる)
export type RouteRow = {
    method: string;
    path: string;
    middlewares: { name: string; applies: "yes" | "no" | "maybe" }[];
};

// ミドルウェアのタブ。order は登録順(= 玉ねぎの外側から内側の順 = 実行順)
export type MiddlewareRow = {
    order: number;
    name: string;
    // 無名の関数だった(名前付きの関数にすると、ここに名前が出る)
    anonymous: boolean;
    path: string | null;
    // 記録しているリクエストのうち、この層を通った件数と、自分の時間の平均(通っていなければ null)
    runs: number;
    avgSelfMs: number | null;
};

export type DashboardPageData = {
    kind: "dashboard";
    // 記録しておく件数の上限
    max: number;
    requests: RequestSummary[];
    routes: RouteRow[];
    middlewares: MiddlewareRow[];
};

export type PageData = ErrorPageData | NotFoundPageData | DashboardPageData;
