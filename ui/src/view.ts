// 画面の計算・判断だけを集めたもの(DOM も Vue も使わないので、bun test でそのまま試せる)
import { EDITORS, type EditorId } from "../../src/dev/editor-url.ts";
import type { EditorGuess } from "../../src/dev/editor.ts";
import type { ErrorPageData, NotFoundPageData, PageFrame } from "../../src/dev/page-data.ts";

// ヒントの文の `...` をコードとして表示するために分ける
export function inlineCode(text: string): { text: string; code: boolean }[] {
    return text
        .split("`")
        .map((part, i) => ({ text: part, code: i % 2 === 1 }))
        .filter((part) => part.text !== "");
}

export function formatMs(ms: number | null): string | null {
    return ms === null ? null : `${ms.toFixed(1)}ms`;
}

// 「通った順番」のバー。幅は self(その層だけの時間)の割合
export function layerBars(layers: ErrorPageData["layers"]) {
    const sum = layers.reduce((s, l) => s + l.self, 0);
    return layers.map((l) => ({
        name: l.name,
        ms: `${formatMs(l.self)}${l.failed ? " ×" : ""}`,
        pct: sum === 0 ? 0 : Math.round((l.self / sum) * 100),
        failed: l.failed,
    }));
}

// ふだんは Senri 内部のフレームを隠す(利用者が直すのは自分のコードなので)
export function visibleFrames(frames: PageFrame[], showInternal: boolean) {
    if (showInternal) return { shown: frames, hidden: 0 };
    const shown = frames.filter((f) => f.kind !== "senri");
    return { shown, hidden: frames.length - shown.length };
}

// --- 404ページのルート一覧 ---

type RouteItem = NotFoundPageData["routes"][number];

// パスかメソッドに含まれるものだけ(大文字小文字は区別しない)
export function filterRoutes(routes: RouteItem[], query: string): RouteItem[] {
    const q = query.trim().toLowerCase();
    if (q === "") return routes;
    return routes.filter((r) => r.path.toLowerCase().includes(q) || r.method.toLowerCase().includes(q));
}

// 絞り込んでいないときは先頭の limit 件だけ出し、「ほか n 件」と残りを数える
export function visibleRoutes(routes: RouteItem[], query: string, limit: number) {
    const matched = filterRoutes(routes, query);
    if (query.trim() !== "") return { shown: matched, rest: 0 };
    return { shown: matched.slice(0, limit), rest: Math.max(matched.length - limit, 0) };
}

const METHOD_COLORS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export function methodColor(method: string): string {
    return METHOD_COLORS.has(method) ? `var(--${method.toLowerCase()})` : "var(--text)";
}

// --- エディタの選択(ブラウザの localStorage に保存する) ---

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const STORAGE_KEY = "senri.editor";

export function loadEditor(storage: StorageLike | undefined, guess: EditorGuess): EditorId {
    try {
        const saved = storage?.getItem(STORAGE_KEY);
        if (saved && EDITORS.some((e) => e.id === saved)) return saved as EditorId;
    } catch {
        // プライベートモードなどで localStorage が使えないこともある
    }
    return guess.id;
}

export function saveEditor(storage: StorageLike | undefined, id: EditorId) {
    try {
        storage?.setItem(STORAGE_KEY, id);
    } catch {
        // 保存できなくても、このページでは選んだものが使われる
    }
}

export function editorOptions(guess: EditorGuess) {
    return EDITORS.map((e) => ({
        id: e.id,
        label: `${e.label}${guess.detected && e.id === guess.id ? "(自動判別)" : ""}${e.experimental ? "(実験的)" : ""}`,
    }));
}

export function openLabel(id: EditorId): string | null {
    const editor = EDITORS.find((e) => e.id === id)!;
    if (id === "copy") return null;
    return `${editor.label} で開く${editor.experimental ? "(実験的)" : ""}`;
}
