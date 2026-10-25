// サーバーを起動したターミナルの環境変数から、使っているエディタを推測する
// (エディタの中のターミナルから起動したときだけ分かる。外のターミナルなら分からない)
//
// 確かめた変数(2026-10):
// - VS Code:  TERM_PROGRAM=vscode            (VS Code のソース terminalEnvironment.ts で設定)
// - Cursor:   CURSOR_TRACE_ID がある          (公式ドキュメントはなく、コミュニティの情報。
//                                              Cursor は VS Code から派生したので TERM_PROGRAM=vscode も付く)
// - JetBrains: TERMINAL_EMULATOR=JetBrains-JediTerm (IntelliJ のソースで設定。WebStorm 以外の IDE も同じ値)
// - Zed:      TERM_PROGRAM=zed / ZED_TERM=true (Zed のドキュメントで確認)
import type { EditorId } from "./editor-url.ts";
import * as runtime from "./runtime.ts";

export type EditorGuess = {
    id: EditorId;
    // 環境変数から分かったか(false なら既定の VS Code)
    detected: boolean;
};

export function guessEditor(env: (name: string) => string | undefined = runtime.env): EditorGuess {
    // Cursor は TERM_PROGRAM=vscode も付くので、先に見る
    if (env("CURSOR_TRACE_ID")) return { id: "cursor", detected: true };

    const termProgram = env("TERM_PROGRAM");
    if (termProgram === "vscode") return { id: "vscode", detected: true };
    if (termProgram === "zed" || env("ZED_TERM") === "true") return { id: "zed", detected: true };
    if (env("TERMINAL_EMULATOR") === "JetBrains-JediTerm") return { id: "webstorm", detected: true };

    return { id: "vscode", detected: false };
}
