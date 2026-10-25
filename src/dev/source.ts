// エラーが起きた行の前後を読み込んで、ページに出す「該当コード」を作る
import type { StackFrame } from "./stack.ts";
import * as runtime from "./runtime.ts";

export type CodeLine = { num: number; code: string; hit: boolean };

export type CodeFrame = {
    file: string;
    line: number;
    col: number;
    lines: CodeLine[];
    // 問題の行の下に出す "    ^^^^"
    caret: string;
    label: string;
};

export type ReadOptions = {
    // プロジェクトのルート。この中のファイルしか読まない。省略するとカレントディレクトリ
    root?: string | null;
    // ファイルを読んでよいか(Deno の権限)。テストで差し替える用
    canRead?: (path: string) => boolean;
    // これより大きいファイルは読まない(誤って巨大なファイルを読み込まないように)
    maxBytes?: number;
};

const CONTEXT = 3;
const MAX_BYTES = 1024 * 1024;

// src は特定のランタイムの型を入れていないので、使う部分だけの型を自分で書く
// (文字列を変数にしてから import すると、TypeScript は node の型を探しにいかない)
type FsLike = {
    stat(path: string): Promise<{ size: number }>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
};
const NODE_FS = "node:fs/promises";

// 等幅フォントで全角(日本語など)は2文字分の幅になるので、^ の位置がずれないよう幅で数える
function width(text: string): number {
    let w = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        const wide =
            (cp >= 0x1100 && cp <= 0x115f) ||
            (cp >= 0x2e80 && cp <= 0xa4cf) ||
            (cp >= 0xac00 && cp <= 0xd7a3) ||
            (cp >= 0xf900 && cp <= 0xfaff) ||
            (cp >= 0xfe30 && cp <= 0xfe4f) ||
            (cp >= 0xff00 && cp <= 0xff60) ||
            (cp >= 0xffe0 && cp <= 0xffe6) ||
            cp >= 0x1f300;
        w += wide ? 2 : 1;
    }
    return w;
}

function makeCaret(code: string, col: number): string {
    const start = Math.min(Math.max(col - 1, 0), code.length);
    // 字下げのタブはそのままタブにしておくと、上の行とそろう
    const before = code.slice(0, start).replace(/[^\t]/g, (ch) => " ".repeat(width(ch)));
    const target = code.slice(start).trimEnd();
    return before + "^".repeat(Math.max(width(target), 1));
}

// "a/./b/../c" → "a/c"。../ でルートの外に出るパスを見抜くため
function normalize(path: string): string {
    const out: string[] = [];
    for (const part of path.split("/")) {
        if (part === ".") continue;
        if (part === "..") out.pop();
        else out.push(part);
    }
    return out.join("/");
}

function isInside(path: string, root: string): boolean {
    const fold = (p: string) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
    const p = fold(normalize(path));
    const r = fold(normalize(root)).replace(/\/$/, "");
    return p.startsWith(`${r}/`);
}

export async function readCodeFrame(frame: StackFrame, options: ReadOptions = {}): Promise<CodeFrame | null> {
    // 利用者のコードだけ。Senri 内部・node_modules・ランタイム内部は読まない
    if (frame.kind !== "user" || frame.line < 1) return null;

    const root = options.root === undefined ? runtime.cwd() : options.root;
    if (!root) return null;
    // スタックに出てきたパスでも、プロジェクトの外や node_modules の中は読まない
    if (!isInside(frame.file, root) || normalize(frame.file).includes("/node_modules/")) return null;

    const canRead = options.canRead ?? runtime.canRead;
    if (!canRead(frame.file)) return null;

    let text: string;
    try {
        // 動的 import にしておくと、ファイルを読めない環境でも Senri 自体は読み込める
        const fs = (await import(NODE_FS)) as FsLike;
        const stat = await fs.stat(frame.file);
        if (stat.size > (options.maxBytes ?? MAX_BYTES)) return null;
        text = await fs.readFile(frame.file, "utf8");
    } catch {
        return null;
    }

    const all = text.split(/\r?\n/);
    // 最後の改行のあとの空文字は行として数えない
    if (all.at(-1) === "") all.pop();
    if (frame.line > all.length) return null;

    const first = Math.max(1, frame.line - CONTEXT);
    const last = Math.min(all.length, frame.line + CONTEXT);
    const lines: CodeLine[] = [];
    for (let num = first; num <= last; num++) {
        lines.push({ num, code: all[num - 1]!, hit: num === frame.line });
    }

    const hitLine = all[frame.line - 1]!;
    // エラーの位置の直前が "throw" か "throw new" なら、その throw で投げたエラー
    // (V8 は "new" の位置、Bun は "Error" の位置を指すので、どちらでも当たるようにする)
    // 行のどこかに throw があるだけでは決めない(同じ行の別の場所で起きたエラーもあるので)
    const thrownHere = /\bthrow\s+(?:new\s+)?$/.test(hitLine.slice(0, Math.max(frame.col - 1, 0)));
    return {
        file: frame.file,
        line: frame.line,
        col: frame.col,
        lines,
        caret: makeCaret(hitLine, frame.col),
        label: thrownHere ? "ここで throw" : "ここでエラー",
    };
}
