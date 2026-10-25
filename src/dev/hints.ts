// よくあるエラーに、直し方のヒントを付ける(ルールベース。当てはまらなければ何も出さない)
// エラーメッセージの書き方はランタイムで違う(Bun と、V8 の Node / Deno)ので、両方を見る
import type { StackFrame } from "./stack.ts";

export type Hint = {
    // `...` で囲んだところはコードとして表示する
    text: string;
    // 下に添える例
    code?: string;
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
        err.message.startsWith("next() が2回呼ばれました")
            ? {
                  text: "1つのミドルウェアで `next()` を2回呼んでいます。`await next()` は1回だけにして、結果を変数に入れて使ってください。",
                  code: "const res = await next();",
              }
            : null,
    (err) =>
        err.message.startsWith("ハンドラーが関数を返しました")
            ? { text: "関数を呼び出さずに返しています。`()` を付けて呼び出した結果を返してください。", code: "return getUser();" }
            : null,
    (err) =>
        err.message.startsWith("ハンドラーが何も返していません")
            ? { text: "ハンドラーが値を返していません。`return` を忘れていないか確かめてください。", code: 'return "ok";' }
            : null,

    // undefined / null のプロパティを読んだ
    (err) => {
        if (!(err instanceof TypeError)) return null;
        const prop = propertyOfNothing(err.message);
        if (!prop) return null;
        return {
            text: `\`undefined\` か \`null\` の値から \`${prop}\` を読もうとしました。\`await\` のし忘れや、\`c.get()\` で値が入っていない場合がよくあります。なくてもよい値なら \`?.\` で読めます。`,
            code: `value?.${prop}`,
        };
    },

    // 関数でないものを呼んだ
    (err) =>
        err instanceof TypeError && / is not a function/.test(err.message)
            ? { text: "呼び出そうとしたものが関数ではありません。名前のつづりや、import しているものを確かめてください。" }
            : null,

    // BigInt を JSON にしようとした
    // V8: Do not know how to serialize a BigInt / Bun: JSON.stringify cannot serialize BigInt.
    (err) =>
        err instanceof TypeError && /serialize (?:a )?BigInt/.test(err.message)
            ? {
                  text: "`BigInt` は JSON にできません。文字列や数値に変換してから返してください。",
                  code: "String(value)",
              }
            : null,

    // リクエストのボディが JSON として読めない(c.req.json())
    // V8: ... in JSON at position 1 / ... is not valid JSON、Bun: JSON Parse error: ...
    (err) =>
        err instanceof SyntaxError && /JSON/.test(err.message)
            ? {
                  text: "JSON として読めませんでした。`c.req.json()` なら、送られてきたボディが壊れています。受け取った側の問題なので、400 で返すのがおすすめです。",
                  code: 'const body = await c.req.json().catch(() => {\n    throw new HttpError(400, "JSON が正しくありません");\n});',
              }
            : null,

    // 普通の Error を投げた(意図したエラーなら HttpError でステータスを決められる)
    // - HttpError や、継承した独自のエラーは、利用者が意図して作ったものなので案内しない
    // - ライブラリ(node_modules)が投げたものも案内しない(DB のエラーを 400 にするのは、たいてい間違い)
    (err, frames) =>
        Object.getPrototypeOf(err) === Error.prototype && thrownByUser(frames)
            ? {
                  text: "ハンドラーやミドルウェアで投げたエラーが、どこでもキャッチされませんでした。意図したエラーなら `HttpError` でステータスコードを指定できます。",
                  code: `throw new HttpError(400, ${JSON.stringify(err.message)})`,
              }
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
