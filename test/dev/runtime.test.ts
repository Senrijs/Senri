import { afterEach, describe, expect, test } from "bun:test";
import { cwd, env } from "../../src/dev/runtime.ts";

// Deno の permissions を真似る偽物を globalThis.Deno に置く
type Desc = { name: string; path?: string; variable?: string };
function fakeDeno(granted: (desc: Desc) => boolean) {
    (globalThis as { Deno?: unknown }).Deno = {
        permissions: { querySync: (desc: Desc) => ({ state: granted(desc) ? "granted" : "prompt" }) },
        cwd: () => "C:\\Users\\me\\app",
        env: { get: (name: string) => (name === "TERM_PROGRAM" ? "vscode" : undefined) },
    };
}

afterEach(() => {
    delete (globalThis as { Deno?: unknown }).Deno;
});

describe("runtime(Deno の権限)", () => {
    test("--allow-read=. のように範囲を絞っていても、カレントディレクトリは読める", () => {
        fakeDeno((d) => d.name === "read" && d.path === ".");

        expect(cwd()).toBe("C:/Users/me/app");
    });

    test("読み込みの権限がまったくなければ null(プロンプトは出さない)", () => {
        fakeDeno(() => false);

        expect(cwd()).toBeNull();
    });

    test("環境変数は、その変数の権限があるときだけ読む", () => {
        fakeDeno((d) => d.name === "env" && d.variable === "TERM_PROGRAM");
        expect(env("TERM_PROGRAM")).toBe("vscode");

        fakeDeno(() => false);
        expect(env("TERM_PROGRAM")).toBeUndefined();
    });
});
