// create-senri のテンプレートが入れる @senrijs/senri の範囲(SENRI_RANGE)が、本体の version を満たすか
// テンプレートのコードは、この範囲の API で書いてある。本体がその外(0.3.0 など)に上がったら、ここで落ちる
// (それが、テンプレートを新しい API に直して、packages/create-senri/version.js の範囲を上げる合図。CONTRIBUTING.md)
//
// *.test.ts にしていないのは、公開前のテスト(test:node と、publish.yml の create-senri の公開ジョブ)に入れないため。
// 本体のリリースで範囲から外れるのは想定どおりなので、公開は止めない。CI(ci.yml の create-senri-range)でだけ動かす。
// *.test.ts に名前を変えると、範囲が外れたときに、本体と create-senri の公開が止まる
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SENRI_RANGE } from "../../packages/create-senri/version.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// "^0.2.2" のような範囲が、version を満たすか(0.x では、マイナーが同じで、パッチ以上)
function satisfiesCaret(range: string, version: string): boolean {
    const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
    const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!m || !v) throw new Error(`Unsupported range or version: ${range} ${version}`);
    const [a, b, c] = m.slice(1).map(Number) as [number, number, number];
    const [x, y, z] = v.slice(1).map(Number) as [number, number, number];
    if (a > 0) return x === a && (y > b || (y === b && z >= c));
    if (b > 0) return x === 0 && y === b && z >= c;
    return x === 0 && y === 0 && z === c;
}

test("create-senri の範囲が、本体の package.json の version を満たす", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.ok(satisfiesCaret(SENRI_RANGE, version), `${SENRI_RANGE} は ${version} を満たさない`);
});
