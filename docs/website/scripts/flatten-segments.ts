// next build のあとに動かす。リンクの先読み(prefetch)のファイルを、ブラウザが読みに来る名前でも置く
// Next.js の静的書き出しは、先読みのファイルを入れ子のフォルダーに書く(例: __next.!KGphKQ/!KGhvbWUp/__PAGE__.txt)
// ブラウザは「/」を「.」にした1つの名前で読みに来る(例: __next.!KGphKQ.!KGhvbWUp.__PAGE__.txt)
// 静的なファイルの配信では読み替えられないので、同じ中身をその名前でもう1つ置く(ないと 404 になり、先読みが効かない)
import { copyFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const OUT = join(import.meta.dirname, "..", "out");

async function filesIn(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((e) => (e.isDirectory() ? filesIn(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
    );
    return nested.flat();
}

let copied = 0;
async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(dir, entry.name);
        if (!entry.name.startsWith("__next.")) {
            await walk(path);
            continue;
        }
        for (const file of await filesIn(path)) {
            const flat = `${entry.name}.${relative(path, file).split(sep).join(".")}`;
            await copyFile(file, join(dir, flat));
            copied++;
        }
    }
}

await walk(OUT);
console.log(`先読みのファイルを ${copied} 個、ブラウザが読む名前でも置きました`);
