// よくあるエラーに、直し方のヒントを付ける(ルールベース。当てはまらなければ何も出さない)
// エラーメッセージの書き方はランタイムで違う(Bun と、V8 の Node / Deno)ので、両方を見る
import { errorCode } from "../errors.ts";
import type { MessageKey, Params } from "./messages.ts";
import type { StackFrame } from "./stack.ts";

// 文章ではなくキーで持つ。ダッシュボードの記録は、あとから別の言語で見ることがあるので(文言は messages.ts)
export type Hint = {
    key: MessageKey;
    params?: Params;
    // 下に添える例。言語で変わるものだけ codeKey
    code?: string;
    codeKey?: MessageKey;
};

type Rule = (err: Error, frames: StackFrame[] | undefined) => Hint | null;

// 利用者のコードが投げたエラーか(ランタイム内部のフレームは飛ばして、いちばん上を見る)
// スタックが分からなければ、利用者のものとして扱う
function thrownByUser(frames: StackFrame[] | undefined): boolean {
    const top = frames?.find((f) => f.kind !== "runtime");
    return top === undefined || top.kind === "user";
}

// プロパティ名を取り出す
// V8:  Cannot read properties of undefined (reading 'name')
// Bun: undefined is not an object (evaluating 'user.name')
function propertyOfNothing(message: string): string | null {
    const v8 = /^Cannot read properties of (?:undefined|null) \(reading '([^']+)'\)/.exec(message);
    if (v8) return v8[1]!;
    const bun = /^(?:undefined|null) is not an object \(evaluating '.*\.([\w$]+)'\)/.exec(message);
    return bun ? bun[1]! : null;
}

const rules: Rule[] = [
    // Senri 自身が投げるエラー
    (err) =>
        errorCode(err) === "next_twice"
            ? { key: "hint.nextTwice", code: "const res = await next();" }
            : null,
    (err) =>
        errorCode(err) === "returned_function"
            ? { key: "hint.returnedFunction", code: "return getUser();" }
            : null,
    (err) =>
        errorCode(err) === "returned_nothing"
            ? { key: "hint.returnedNothing", code: 'return "ok";' }
            : null,

    // undefined / null のプロパティを読んだ
    (err) => {
        if (!(err instanceof TypeError)) return null;
        const prop = propertyOfNothing(err.message);
        if (!prop) return null;
        return { key: "hint.readNothing", params: { prop }, code: `value?.${prop}` };
    },

    // 関数でないものを呼んだ
    (err) =>
        err instanceof TypeError && / is not a function/.test(err.message)
            ? { key: "hint.notFunction" }
            : null,

    // BigInt を JSON にしようとした
    // V8: Do not know how to serialize a BigInt / Bun: JSON.stringify cannot serialize BigInt.
    (err) =>
        err instanceof TypeError && /serialize (?:a )?BigInt/.test(err.message)
            ? { key: "hint.bigint", code: "String(value)" }
            : null,

    // リクエストのボディが JSON として読めない(c.req.json())
    // V8: ... in JSON at position 1 / ... is not valid JSON、Bun: JSON Parse error: ...
    (err) =>
        err instanceof SyntaxError && /JSON/.test(err.message)
            ? { key: "hint.json", codeKey: "hint.jsonCode" }
            : null,

    // 普通の Error を投げた(意図したエラーなら HttpError でステータスを決められる)
    // - HttpError や、継承した独自のエラーは、利用者が意図して作ったものなので案内しない
    // - ライブラリ(node_modules)が投げたものも案内しない(DB のエラーを 400 にするのは、たいてい間違い)
    (err, frames) =>
        Object.getPrototypeOf(err) === Error.prototype && thrownByUser(frames)
            ? { key: "hint.uncaught", code: `throw new HttpError(400, ${JSON.stringify(err.message)})` }
            : null,
];

export function hintFor(err: unknown, frames?: StackFrame[]): Hint | null {
    if (!(err instanceof Error)) return null;
    for (const rule of rules) {
        const hint = rule(err, frames);
        if (hint) return hint;
    }
    return null;
}
