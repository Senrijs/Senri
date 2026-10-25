import { describe, expect, test } from "bun:test";
import { readCodeFrame } from "../../src/dev/source.ts";
import type { StackFrame } from "../../src/dev/stack.ts";

// test/dev/fixtures をプロジェクトのルートとみなす
const root = decodeURIComponent(new URL("./fixtures", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const file = `${root}/sample.ts`;
const frame = (overrides: Partial<StackFrame> = {}): StackFrame => ({
    fn: "<anonymous>",
    file,
    line: 6,
    col: 11,
    kind: "user",
    ...overrides,
});

describe("readCodeFrame", () => {
    test("エラー行の前後3行を、行番号付きで返す", async () => {
        const code = await readCodeFrame(frame(), { root });

        expect(code!.lines).toEqual([
            { num: 3, code: "const app = createApp();", hit: false },
            { num: 4, code: "", hit: false },
            { num: 5, code: 'app.get("/boom", () => {', hit: false },
            { num: 6, code: '    throw new Error("わざと壊した");', hit: true },
            { num: 7, code: "});", hit: false },
            { num: 8, code: "", hit: false },
            { num: 9, code: 'app.get("/ok", () => "ok");', hit: false },
        ]);
    });

    test("問題の行には、列の位置から行末まで ^ を付ける(全角は2文字分)", async () => {
        const code = await readCodeFrame(frame(), { root });

        // 6行目の11列目("new")から行末まで。半角14文字 + 全角6文字×2 = 26
        expect(code!.caret).toBe(" ".repeat(10) + "^".repeat(26));
        expect(code!.label).toBe("ここで throw");
    });

    test("ファイルの先頭や末尾では、ある分だけ返す", async () => {
        const top = await readCodeFrame(frame({ line: 1, col: 1 }), { root });
        const bottom = await readCodeFrame(frame({ line: 12, col: 1 }), { root });

        expect(top!.lines.map((l) => l.num)).toEqual([1, 2, 3, 4]);
        expect(bottom!.lines.map((l) => l.num)).toEqual([9, 10, 11, 12]);
    });

    test("「ここで throw」は、エラーの位置の直前が throw のときだけ(V8 と Bun の列の違いも)", async () => {
        // V8 は "new" の位置(11列目)、Bun は "Error" の位置(15列目)を指す
        expect((await readCodeFrame(frame({ line: 6, col: 11 }), { root }))!.label).toBe("ここで throw");
        expect((await readCodeFrame(frame({ line: 6, col: 15 }), { root }))!.label).toBe("ここで throw");
    });

    test("同じ行に throw があっても、エラーが別の場所なら「ここでエラー」", async () => {
        const line = 'export const pick = (x: { a?: { b: number } }) => { if (!x) throw new Error("no"); return x.a!.b; };';
        const col = line.indexOf("x.a!.b") + 1;

        expect((await readCodeFrame(frame({ line: 12, col }), { root }))!.label).toBe("ここでエラー");
    });

    describe("読まないもの(null を返す)", () => {
        test("利用者のコードでないフレーム", async () => {
            for (const kind of ["senri", "node_modules", "runtime"] as const) {
                expect(await readCodeFrame(frame({ kind }), { root })).toBeNull();
            }
        });

        test("スタックに出ていても、プロジェクトの外のファイル", async () => {
            const outside = `${root}/../stack.test.ts`;

            expect(await readCodeFrame(frame({ file: outside }), { root })).toBeNull();
        });

        test("プロジェクトの中でも node_modules の中", async () => {
            const inNodeModules = `${root}/node_modules/lib/index.ts`;

            expect(await readCodeFrame(frame({ file: inNodeModules }), { root })).toBeNull();
        });

        test("../ でプロジェクトの外に出るパス", async () => {
            const sneaky = `${root}/../../../package.json`;

            expect(await readCodeFrame(frame({ file: sneaky }), { root })).toBeNull();
        });

        test("ファイルが読めない(権限がない、存在しない)", async () => {
            expect(await readCodeFrame(frame(), { root, canRead: () => false })).toBeNull();
            expect(await readCodeFrame(frame({ file: `${root}/nope.ts` }), { root })).toBeNull();
        });

        test("大きすぎるファイル", async () => {
            expect(await readCodeFrame(frame(), { root, maxBytes: 10 })).toBeNull();
        });

        test("プロジェクトのルートが分からない", async () => {
            expect(await readCodeFrame(frame(), { root: null })).toBeNull();
        });

        test("行番号がファイルの範囲外", async () => {
            expect(await readCodeFrame(frame({ line: 999 }), { root })).toBeNull();
        });
    });
});
