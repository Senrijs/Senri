// 見出しを動かすときの区切り方。日本語は1文字ずつ、英語は空白で区切った1単語ずつ(空白も1つの区切りとして残す)
import type { Lang } from "@/lib/i18n";

export function segments(text: string, lang: Lang): string[] {
    return lang === "ja" ? Array.from(text) : text.split(/(\s+)/).filter((s) => s !== "");
}
