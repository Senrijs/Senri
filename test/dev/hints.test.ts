import { describe, expect, test } from "bun:test";
import { HttpError } from "../../src/index.ts";
import { hintFor } from "../../src/dev/hints.ts";
import { senriError } from "../../src/errors.ts";

// 3ランタイムで実際に出るメッセージ(Bun と、V8 の Node / Deno で書き方が違う)
const typeError = (message: string) => new TypeError(message);

describe("hintFor", () => {
    test("普通の Error を投げた → HttpError の案内", () => {
        const hint = hintFor(new Error("id が数字ではありません"));

        expect(hint!.text).toContain("`HttpError`");
        expect(hint!.code).toBe('throw new HttpError(400, "id が数字ではありません")');
    });

    test("案内の文は、ハンドラーにもミドルウェアにも当てはまる言い方にする", () => {
        expect(hintFor(new Error("x"))!.text).toContain("ハンドラーやミドルウェア");
    });

    test("ライブラリ(node_modules)が投げた普通の Error には、HttpError の案内を出さない", () => {
        const frames = [
            { fn: "query", file: "/app/node_modules/db/index.js", line: 1, col: 1, kind: "node_modules" as const },
            { fn: "handler", file: "/app/src/index.ts", line: 3, col: 9, kind: "user" as const },
        ];

        expect(hintFor(new Error("connection refused"), frames)).toBeNull();
    });

    test("ランタイム内部のフレームは飛ばして、その次が利用者のコードなら案内する", () => {
        const frames = [
            { fn: "x", file: "node:internal/x", line: 1, col: 1, kind: "runtime" as const },
            { fn: "handler", file: "/app/src/index.ts", line: 3, col: 9, kind: "user" as const },
        ];

        expect(hintFor(new Error("x"), frames)!.text).toContain("HttpError");
    });

    test("HttpError や、Error を継承した独自のエラーには HttpError の案内を出さない", () => {
        class MyError extends Error {}

        expect(hintFor(new HttpError(500, "x"))).toBeNull();
        expect(hintFor(new MyError("x"))).toBeNull();
    });

    test("undefined / null のプロパティを読んだ(V8 と Bun の両方)", () => {
        const messages = [
            "Cannot read properties of undefined (reading 'name')",
            "Cannot read properties of null (reading 'name')",
            "undefined is not an object (evaluating '(void 0).name')",
            "null is not an object (evaluating 'user.name')",
        ];
        for (const message of messages) {
            const hint = hintFor(typeError(message));
            expect(hint!.text).toContain("`name`");
            expect(hint!.code).toBe("value?.name");
        }
    });

    test("関数でないものを呼んだ(V8 と Bun の両方)", () => {
        for (const message of ["f.go is not a function", "{}.go is not a function. (In '{}.go()', '{}.go' is undefined)"]) {
            expect(hintFor(typeError(message))!.text).toContain("関数ではありません");
        }
    });

    test("BigInt を JSON にしようとした(V8 と Bun の両方)", () => {
        for (const message of ["Do not know how to serialize a BigInt", "JSON.stringify cannot serialize BigInt."]) {
            const hint = hintFor(typeError(message));
            expect(hint!.text).toContain("BigInt");
            expect(hint!.code).toBe("String(value)");
        }
    });

    test("JSON として読めないボディ(V8 と Bun の両方)", () => {
        const messages = [
            "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
            `Unexpected token 'a', "abc" is not valid JSON`,
            "JSON Parse error: Expected '}'",
        ];
        for (const message of messages) {
            const hint = hintFor(new SyntaxError(message));
            expect(hint!.text).toContain("JSON");
            expect(hint!.code).toContain("HttpError(400");
        }
    });

    test("Senri が投げるエラー(next() の二重呼び出し、関数や undefined を返した)", () => {
        // 文言ではなく code で見分ける(本体の文言は短い英語)
        expect(hintFor(senriError("next_twice", "next() called twice"))!.text).toContain("await next()");
        expect(hintFor(senriError("returned_function", new TypeError("Handler returned a function")))!.code).toContain("()");
        expect(hintFor(senriError("returned_nothing", new TypeError("Handler returned undefined or null")))!.text).toContain(
            "return",
        );
    });

    test("当てはまらなければ null", () => {
        expect(hintFor(new RangeError("Invalid array length"))).toBeNull();
        expect(hintFor("文字列を投げた")).toBeNull();
    });
});
