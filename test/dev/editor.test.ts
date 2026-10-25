import { describe, expect, test } from "bun:test";
import { guessEditor } from "../../src/dev/editor.ts";
import { copyText, editorUrl } from "../../src/dev/editor-url.ts";

const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

describe("guessEditor: 環境変数からエディタを推測する", () => {
    test("VS Code のターミナル(TERM_PROGRAM=vscode)", () => {
        expect(guessEditor(envOf({ TERM_PROGRAM: "vscode" }))).toEqual({ id: "vscode", detected: true });
    });

    test("Cursor は TERM_PROGRAM=vscode も付くが、CURSOR_TRACE_ID で見分ける", () => {
        expect(guessEditor(envOf({ TERM_PROGRAM: "vscode", CURSOR_TRACE_ID: "abc" }))).toEqual({
            id: "cursor",
            detected: true,
        });
    });

    test("JetBrains の IDE のターミナル(TERMINAL_EMULATOR=JetBrains-JediTerm)は WebStorm", () => {
        expect(guessEditor(envOf({ TERMINAL_EMULATOR: "JetBrains-JediTerm" })).id).toBe("webstorm");
    });

    test("Zed のターミナル(TERM_PROGRAM=zed か ZED_TERM=true)", () => {
        expect(guessEditor(envOf({ TERM_PROGRAM: "zed" })).id).toBe("zed");
        expect(guessEditor(envOf({ ZED_TERM: "true" })).id).toBe("zed");
    });

    test("分からなければ VS Code(detected: false)", () => {
        expect(guessEditor(envOf({}))).toEqual({ id: "vscode", detected: false });
        expect(guessEditor(envOf({ TERM_PROGRAM: "Apple_Terminal" }))).toEqual({ id: "vscode", detected: false });
    });
});

describe("editorUrl: エディタでファイルを開く URL", () => {
    const win = { file: "C:/Users/SHO TAKAHASHI/app/src/index.ts", line: 38, col: 15, root: "C:/Users/SHO TAKAHASHI/app" };
    const posix = { file: "/home/me/app/src/index.ts", line: 3, col: 9, root: "/home/me/app" };

    test("VS Code / Cursor / Zed は <scheme>://file/<絶対パス>:行:列", () => {
        expect(editorUrl("vscode", win)).toBe("vscode://file/C:/Users/SHO%20TAKAHASHI/app/src/index.ts:38:15");
        expect(editorUrl("cursor", win)).toBe("cursor://file/C:/Users/SHO%20TAKAHASHI/app/src/index.ts:38:15");
        expect(editorUrl("zed", posix)).toBe("zed://file/home/me/app/src/index.ts:3:9");
        expect(editorUrl("vscode", posix)).toBe("vscode://file/home/me/app/src/index.ts:3:9");
    });

    test("パスの # や ? はエンコードする(URL の区切りと間違えられないように)", () => {
        expect(editorUrl("vscode", { ...posix, file: "/home/me/a#b?c.ts" })).toBe(
            "vscode://file/home/me/a%23b%3Fc.ts:3:9",
        );
    });

    test("WebStorm は Toolbox の形式(プロジェクト名 + 相対パス)", () => {
        expect(editorUrl("webstorm", win)).toBe(
            "jetbrains://web-storm/navigate/reference?project=app&path=src/index.ts:38:15",
        );
    });

    test("WebStorm はプロジェクトの外のファイルを開けない(null)", () => {
        expect(editorUrl("webstorm", { ...posix, file: "/tmp/other.ts" })).toBeNull();
        expect(editorUrl("webstorm", { ...posix, root: null })).toBeNull();
    });

    test("コピーのみは URL なし", () => {
        expect(editorUrl("copy", posix)).toBeNull();
    });

    test("コピーするのは 絶対パス:行:列", () => {
        expect(copyText(win)).toBe("C:/Users/SHO TAKAHASHI/app/src/index.ts:38:15");
    });
});
