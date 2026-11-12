// ドキュメントの「こうすると、こうなる」(ページのしるし)と、それを確かめるテスト(test/docs)が 1 対 1 で対応しているかを確かめる
//
// - ページ(docs/website/content/docs/ja/**/*.mdx)には、主張のところに {/* verify: <名前> */} を置く
// - テスト(test/docs/*.test.ts)は claim("<ページ>#<名前>", ...) で確かめる。ページは content/docs/ja からのパス(拡張子なし)
// - 次のどれかがあれば、一覧を出して失敗する
//   - しるしがあるのに、テストがない(ページに主張を足して、テストを書き忘れた)
//   - テストがあるのに、しるしがない(ページから主張を消したのに、テストが残っている。または id の書き間違い)
//   - 同じ id が 2 回ある
//
// 使い方: node scripts/check-doc-claims.ts
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PAGES = join(ROOT, "docs/website/content/docs/ja");
const TESTS = join(ROOT, "test/docs");

function files(dir: string, ext: string): string[] {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(ext))
        .map((e) => join(e.parentPath, e.name));
}

const problems: string[] = [];

// ページのしるし
const marked = new Map<string, string>();
for (const file of files(PAGES, ".mdx")) {
    const page = relative(PAGES, file).replaceAll("\\", "/").replace(/\.mdx$/, "");
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\{\/\*\s*verify:\s*([\w-]+)\s*\*\/\}/g)) {
        const id = `${page}#${m[1]}`;
        if (marked.has(id)) problems.push(`ページに同じしるしが 2 つあります: ${id}`);
        marked.set(id, page);
    }
}

// テストの id
const tested = new Map<string, string>();
for (const file of files(TESTS, ".test.ts")) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bclaim\(\s*"([^"]+)"/g)) {
        const id = m[1]!;
        if (tested.has(id)) problems.push(`テストに同じ id が 2 つあります: ${id}`);
        tested.set(id, relative(ROOT, file).replaceAll("\\", "/"));
    }
}

for (const id of marked.keys()) {
    if (!tested.has(id)) problems.push(`ページにしるしがあるのに、テストがありません: ${id}`);
}
for (const [id, file] of tested) {
    if (!marked.has(id)) problems.push(`テストがあるのに、ページにしるしがありません: ${id}(${file})`);
}

if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\nページのしるしは {/* verify: <名前> */}、テストは claim("<ページ>#<名前>", ...) です(test/docs/claim.ts)`);
    process.exit(1);
}
console.log(`ドキュメントの主張 ${marked.size} 件が、どれもテストと対応しています`);
