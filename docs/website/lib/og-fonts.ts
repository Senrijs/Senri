// OG 画像のフォント(Noto Sans JP)。フォントのファイルはリポジトリに入れず、@fontsource/noto-sans-jp から読む
// Noto Sans JP は文字の範囲ごとに 100 以上のファイルに分かれている。700.css / 400.css の unicode-range を見て、
// 画像に書く文字を含むファイルだけを渡す(全部渡すと 1 枚ごとに 5 MB 以上読むことになる)
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Weight = 400 | 700;
type Subset = { file: string; ranges: [number, number][] };

// サイトのビルドは docs/website で動かす(バンドラーが require.resolve を置き換えるので、パスで指す)
const dir = join(process.cwd(), "node_modules", "@fontsource", "noto-sans-jp");

const subsets = new Map<Weight, Promise<Subset[]>>();
const files = new Map<string, Promise<Buffer>>();

function parseRanges(text: string): [number, number][] {
    return text.split(",").map((part) => {
        const [start, end] = part.trim().replace(/^U\+/i, "").split("-");
        return [Number.parseInt(start!, 16), Number.parseInt(end ?? start!, 16)];
    });
}

function subsetsOf(weight: Weight): Promise<Subset[]> {
    let list = subsets.get(weight);
    if (!list) {
        list = readFile(join(dir, `${weight}.css`), "utf8").then((css) =>
            [...css.matchAll(/url\(\.\/files\/([^)]+\.woff)\) format\('woff'\);\s*unicode-range:\s*([^;]+);/g)].map((m) => ({
                file: m[1]!,
                ranges: parseRanges(m[2]!),
            })),
        );
        subsets.set(weight, list);
    }
    return list;
}

function load(file: string): Promise<Buffer> {
    let data = files.get(file);
    if (!data) {
        data = readFile(join(dir, "files", file));
        files.set(file, data);
    }
    return data;
}

export async function ogFonts(text: string) {
    const codes = new Set([...text].map((c) => c.codePointAt(0)!));
    const fonts = [];
    for (const weight of [400, 700] as const) {
        for (const subset of await subsetsOf(weight)) {
            if (![...codes].some((code) => subset.ranges.some(([start, end]) => code >= start && code <= end))) continue;
            fonts.push({ name: "Noto Sans JP", data: await load(subset.file), weight, style: "normal" as const });
        }
    }
    return fonts;
}
