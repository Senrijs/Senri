// エディタでファイルを開く URL を作る。サーバーでもブラウザ(エラーページ)でも使うので、
// ランタイムに頼らない純粋な関数だけを置く
//
// 確かめた形式(2026-10):
// - VS Code: vscode://file/<絶対パス>:行:列
// - Cursor:  cursor://file/<絶対パス>:行:列 (VS Code と同じ形。公式ドキュメントはなく、コミュニティの情報)
// - Zed:     zed://file/<絶対パス>:行:列    (Zed のソース open_listener.rs で確認)
// - WebStorm: jetbrains://web-storm/navigate/reference?project=<名前>&path=<相対パス>:行:列
//            JetBrains Toolbox が必要で、公式ドキュメントはない(実験的)

export type EditorId = "vscode" | "cursor" | "webstorm" | "zed" | "copy";

export const EDITORS: { id: EditorId; label: string; experimental?: boolean }[] = [
    { id: "vscode", label: "VS Code" },
    { id: "cursor", label: "Cursor" },
    { id: "webstorm", label: "WebStorm", experimental: true },
    { id: "zed", label: "Zed" },
    { id: "copy", label: "コピーのみ" },
];

export type Location = {
    // スラッシュ区切りの絶対パス
    file: string;
    line: number;
    col: number;
    // プロジェクトのルート(WebStorm で相対パスにするのに使う)
    root: string | null;
};

// 1つずつのフォルダ名をエンコードする("#" や "?" が URL の区切りと間違えられないように)
// Windows のドライブ "C:" の ":" はそのまま残す("/C:/..." と分けると2番目に来る)
function encodePath(path: string): string {
    return path
        .split("/")
        .map((part, i) => (i <= 1 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
        .join("/");
}

function fileUrl(scheme: string, { file, line, col }: Location): string {
    // POSIX は "/home/..." なのでそのまま、Windows は "C:/..." なので "/" を足す
    const path = file.startsWith("/") ? file : `/${file}`;
    return `${scheme}://file${encodePath(path)}:${line}:${col}`;
}

function relativeTo(file: string, root: string): string | null {
    const fold = (p: string) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
    const r = root.replace(/\/$/, "");
    if (!fold(file).startsWith(`${fold(r)}/`)) return null;
    return file.slice(r.length + 1);
}

export function editorUrl(editor: EditorId, loc: Location): string | null {
    switch (editor) {
        case "vscode":
        case "cursor":
        case "zed":
            return fileUrl(editor, loc);
        case "webstorm": {
            // Toolbox の形式は「プロジェクト名 + その中の相対パス」で指定する
            if (!loc.root) return null;
            const rel = relativeTo(loc.file, loc.root);
            if (rel === null) return null;
            const project = loc.root.replace(/\/$/, "").split("/").at(-1)!;
            return (
                `jetbrains://web-storm/navigate/reference?project=${encodeURIComponent(project)}` +
                `&path=${encodePath(rel)}:${loc.line}:${loc.col}`
            );
        }
        case "copy":
            return null;
    }
}

// コピーボタンで入れる文字列。多くのエディタの「ファイルを開く」にそのまま貼れる
export function copyText({ file, line, col }: Location): string {
    return `${file}:${line}:${col}`;
}
