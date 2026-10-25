import { describe, expect, test } from "bun:test";
import { parseStack } from "../../src/dev/stack.ts";

// Senri 本体がここにある、という前提で分類する
const senriDirs = ["C:/Users/me/senri/src", "C:/Users/me/senri/adapters"];
const pick = (stack: string) =>
    parseStack(stack, { senriDirs }).map(({ fn, file, line, col, kind }) => ({ fn, file, line, col, kind }));

describe("parseStack: 3ランタイムの実際の書式", () => {
    test("Bun(Windows の生のパス、<anonymous>)", () => {
        const stack = [
            "Error: わざと壊した",
            "    at getUser (C:\\Users\\me\\app\\routes.ts:6:15)",
            "    at <anonymous> (C:\\Users\\me\\senri\\src\\app.ts:193:71)",
            "    at processTicksAndRejections (native:7:39)",
        ].join("\n");

        expect(pick(stack)).toEqual([
            { fn: "getUser", file: "C:/Users/me/app/routes.ts", line: 6, col: 15, kind: "user" },
            { fn: "<anonymous>", file: "C:/Users/me/senri/src/app.ts", line: 193, col: 71, kind: "senri" },
            { fn: "processTicksAndRejections", file: "native", line: 7, col: 39, kind: "runtime" },
        ]);
    });

    test("Node(エンコードされた file:// URL、Object. と [as x] の飾り)", () => {
        const stack = [
            "Error: わざと壊した",
            "    at getUser (file:///C:/Users/SHO%20TAKAHASHI/app/routes.ts:6:11)",
            "    at Object.auth [as mw] (file:///C:/Users/SHO%20TAKAHASHI/app/mw.ts:8:47)",
            "    at file:///C:/Users/me/senri/src/compose.ts:51:30",
            "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
        ].join("\n");

        expect(pick(stack)).toEqual([
            { fn: "getUser", file: "C:/Users/SHO TAKAHASHI/app/routes.ts", line: 6, col: 11, kind: "user" },
            { fn: "auth", file: "C:/Users/SHO TAKAHASHI/app/mw.ts", line: 8, col: 47, kind: "user" },
            { fn: "<anonymous>", file: "C:/Users/me/senri/src/compose.ts", line: 51, col: 30, kind: "senri" },
            {
                fn: "process.processTicksAndRejections",
                file: "node:internal/process/task_queues",
                line: 105,
                col: 5,
                kind: "runtime",
            },
        ]);
    });

    test("Deno(エンコードありとなしの file:// URL が混ざる、ext:)", () => {
        const stack = [
            "Error: わざと壊した",
            "    at getUser (file:///C:/Users/SHO%20TAKAHASHI/app/routes.ts:6:11)",
            "    at run (file:///C:/Users/SHO TAKAHASHI/senri/src/app.ts:193:71)",
            "    at eventLoopTick (ext:core/01_core.js:179:7)",
        ].join("\n");

        expect(pick(stack).map((f) => [f.file, f.kind])).toEqual([
            ["C:/Users/SHO TAKAHASHI/app/routes.ts", "user"],
            ["C:/Users/SHO TAKAHASHI/senri/src/app.ts", "user"],
            ["ext:core/01_core.js", "runtime"],
        ]);
    });
});

describe("parseStack: そのほかの形", () => {
    test("POSIX のパスと node_modules", () => {
        const stack = [
            "TypeError: x is not a function",
            "    at handler (/home/me/app/src/index.ts:3:9)",
            "    at Layer.handle (/home/me/app/node_modules/some-lib/dist/index.js:10:2)",
            "    at async Promise.all (index 0)",
            "    at new Promise (<anonymous>)",
        ].join("\n");

        expect(pick(stack)).toEqual([
            { fn: "handler", file: "/home/me/app/src/index.ts", line: 3, col: 9, kind: "user" },
            { fn: "Layer.handle", file: "/home/me/app/node_modules/some-lib/dist/index.js", line: 10, col: 2, kind: "node_modules" },
            { fn: "Promise.all", file: "index 0", line: 0, col: 0, kind: "runtime" },
            { fn: "new Promise", file: "<anonymous>", line: 0, col: 0, kind: "runtime" },
        ]);
    });

    test("node_modules に入った Senri は、node_modules ではなく senri", () => {
        const stack = "Error\n    at dispatch (/home/me/app/node_modules/senri/dist/src/compose.js:28:26)";

        const [frame] = parseStack(stack, { senriDirs: ["/home/me/app/node_modules/senri/dist"] });

        expect(frame!.kind).toBe("senri");
    });

    test("パスに括弧や空白があっても、末尾の :行:列 から読む", () => {
        const stack = "Error\n    at main (C:\\Program Files (x86)\\app\\main.ts:2:4)";

        expect(pick(stack)[0]).toEqual({
            fn: "main",
            file: "C:/Program Files (x86)/app/main.ts",
            line: 2,
            col: 4,
            kind: "user",
        });
    });

    test("ドライブ文字の大文字小文字が違っても Senri 内部と分かる", () => {
        const stack = "Error\n    at x (c:\\users\\me\\senri\\src\\app.ts:1:1)";

        expect(pick(stack)[0]!.kind).toBe("senri");
    });

    test("1行目のメッセージや、at で始まらない行は無視する", () => {
        expect(pick("Error: 複数行の\nメッセージ\n    at f (/a.ts:1:2)")).toHaveLength(1);
        expect(pick("")).toEqual([]);
    });

    test("senriDirs を省略すると、このファイルの場所から Senri 本体を判定する", () => {
        const here = new URL("../../src/app.ts", import.meta.url).href;

        const [frame] = parseStack(`Error\n    at fetch (${here}:1:1)`);

        expect(frame!.kind).toBe("senri");
    });
});
