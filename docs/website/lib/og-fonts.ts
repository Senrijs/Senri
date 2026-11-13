// OG 画像のフォント。フォントのファイルはリポジトリに入れず、@fontsource から読む(Satori は woff2 を読めないので woff)
// - Noto Sans JP(400・500・900): 文字の範囲ごとに 100 以上のファイルに分かれている。各太さの CSS の unicode-range を見て、
//   画像に書く文字を含むファイルだけを渡す(全部渡すと 1 枚ごとに 5 MB 以上読むことになる)
// - Inter(800): 後ろの大きな英単語。JetBrains Mono(600): ページの種類のラベル。どちらもラテン文字のファイルだけ
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Weight = 400 | 500 | 900;
type Subset = { file: string; ranges: [number, number][] };

// サイトのビルドは docs/website で動かす(バンドラーが require.resolve を置き換えるので、パスで指す)
const fontsource = join(process.cwd(), "node_modules", "@fontsource");
const jp = join(fontsource, "noto-sans-jp");

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
        list = readFile(join(jp, `${weight}.css`), "utf8").then((css) =>
            [...css.matchAll(/url\(\.\/files\/([^)]+\.woff)\) format\('woff'\);\s*unicode-range:\s*([^;]+);/g)].map((m) => ({
                file: m[1]!,
                ranges: parseRanges(m[2]!),
            })),
        );
        subsets.set(weight, list);
    }
    return list;
}

function load(path: string): Promise<Buffer> {
    let data = files.get(path);
    if (!data) {
        data = readFile(path);
        files.set(path, data);
    }
    return data;
}

// Satori は、同じ名前のフォントが太さごと・文字の範囲ごとに複数あると、最初の 1 つにない字を、登録した順に別の太さから拾ってしまう
// そこで、ファイルごとに別の名前(jp900-3 など)を付け、要素の fontFamily にはその太さの名前を全部並べる(family(900))
export async function ogFonts(text: string) {
    const codes = new Set([...text].map((c) => c.codePointAt(0)!));
    const fonts = [
        { name: "Inter", data: await load(join(fontsource, "inter", "files", "inter-latin-800-normal.woff")), weight: 800 as const, style: "normal" as const },
        {
            name: "JetBrains Mono",
            data: await load(join(fontsource, "jetbrains-mono", "files", "jetbrains-mono-latin-600-normal.woff")),
            weight: 600 as const,
            style: "normal" as const,
        },
    ];
    const names: Record<Weight, string[]> = { 400: [], 500: [], 900: [] };
    for (const weight of [400, 500, 900] as const) {
        for (const subset of await subsetsOf(weight)) {
            if (![...codes].some((code) => subset.ranges.some(([start, end]) => code >= start && code <= end))) continue;
            const name = `jp${weight}-${names[weight].length}`;
            names[weight].push(name);
            fonts.push({ name, data: await load(join(jp, "files", subset.file)), weight: weight as never, style: "normal" as const });
        }
    }
    return { fonts, family: (weight: Weight) => names[weight].join(", ") || "sans-serif" };
}
