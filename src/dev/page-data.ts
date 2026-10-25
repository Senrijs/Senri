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
};

export type NotFoundPageData = {
    kind: "notFound";
    method: string;
    path: string;
    suggestion: (Difference & { method: string; path: string; link: boolean }) | null;
    routes: { method: string; path: string; link: boolean }[];
};

export type PageData = ErrorPageData | NotFoundPageData;
