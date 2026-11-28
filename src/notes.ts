// 純正のミドルウェア(chaos() / selfHeal())が「このリクエストに何をしたか」を書いておき、開発ダッシュボード(/_senri)が読む
// 本体と入口からは読み込まない(使うミドルウェアと @senrijs/senri/dev だけに入る)。Context も読み込まない
import type { Lang } from "./lang.ts";

// layer: 書いたミドルウェアの名前(玉ねぎタイムラインの行の名前と同じ)
// tag: タイムラインの行に付ける短い印("カオス" など) / text: 何をしたか
// 文言は両方の言語で持つ(画面の言語はリクエストで決まる)
export type Note = { layer: string; tag: Record<Lang, string>; text: Record<Lang, string> };

const notes = new WeakMap<object, Note[]>();

export function addNote(c: object, note: Note): void {
    const list = notes.get(c);
    if (list) list.push(note);
    else notes.set(c, [note]);
}

export function notesOf(c: object): readonly Note[] {
    return notes.get(c) ?? [];
}
