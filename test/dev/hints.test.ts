import { describe, expect, test } from "bun:test";
import { HttpError } from "../../src/index.ts";
import { hintFor } from "../../src/dev/hints.ts";

// 3ランタイムで実際に出るメッセージ(Bun と、V8 の Node / Deno で書き方が違う)
const typeError = (message: string) => new TypeError(message);

describe("hintFor", () => {
    test("普通の Error を投げた → HttpError の案内", () => {
        const hint = hintFor(new Error("id が数字ではありません"));

        expect(hint!.text).toContain("`HttpError`");
        expect(hint!.code).toBe('throw new HttpError(400, "id が数字ではありません")');
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
        expect(hintFor(new Error("next() が2回呼ばれました。1つのミドルウェアで呼べるのは1回だけです"))!.text).toContain(
            "await next()",
        );
        expect(hintFor(new TypeError("ハンドラーが関数を返しました。呼び出し忘れではありませんか？"))!.code).toContain(
            "()",
        );
        expect(hintFor(new TypeError("ハンドラーが何も返していません(undefined / null)"))!.text).toContain("return");
    });

    test("当てはまらなければ null", () => {
        expect(hintFor(new RangeError("Invalid array length"))).toBeNull();
        expect(hintFor("文字列を投げた")).toBeNull();
    });
});
