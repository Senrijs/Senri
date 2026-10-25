// 該当コードの読み込み(動的 import の node:fs)が Node 本体でも動くか
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readCodeFrame } from "../../src/dev/source.ts";

const root = fileURLToPath(new URL("../dev/fixtures", import.meta.url)).replaceAll("\\", "/");

describe("readCodeFrame(Node)", () => {
    test("ファイルを読んで、エラー行に印を付ける", async () => {
        const code = await readCodeFrame(
            { fn: "<anonymous>", file: `${root}/sample.ts`, line: 6, col: 11, kind: "user" },
            { root },
        );

        assert.ok(code);
        assert.equal(code.lines.find((l) => l.hit)?.num, 6);
    });
});
