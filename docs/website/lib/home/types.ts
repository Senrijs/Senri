// scripts/home-data.ts がビルドのときに書き出すデータ(lib/home/generated.json)の形
import type { Lang } from "@/lib/i18n";

// ターミナルの色。ANSI のエスケープを読んで、この名前にする
export type Tone = "dim" | "bold" | "green" | "cyan" | "yellow" | "red" | "magenta" | "accent";
export type Segment = { text: string; tone?: Tone };
export type Line = Segment[];

// 本物の logger() が出した1件分。error は、そのあとに出た赤い行(先頭の2行だけ)
export type LogEntry = { line: Line; error: Line[] };

// 本物の Senri で、プレイグラウンドの最初のコードを動かした結果
export type Recording = {
    method: string;
    path: string;
    status: number;
    statusText: string;
    type: string | null;
    location: string | null;
    // 本文。HTML を求めないリクエストなので、開発モードの 404 と 500 も文字で返る(「もしかして」もここに出る)
    body: string | null;
    error: { name: string; message: string; line: number | null; hint: string | null; hintCode: string | null } | null;
};

export type HomeData = {
    version: string;
    // serve() の既定のポート
    port: number;
    stats: { stars: number | null; downloads: number | null };
    cli: { banner: Record<Lang, Line[]>; logs: LogEntry[] };
    playground: Record<Lang, Recording[]>;
};
