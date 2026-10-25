// HTML に埋め込む前に必ず通す(エラーページやダッシュボード用)
// リクエストのパスやエラーメッセージは攻撃者が自由に決められるので、
// そのまま埋め込むと <script> を仕込まれる(反射型 XSS)
const ENTITIES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
    // 1文字ずつ置き換えるので、& を先に処理しなくても二重にエスケープされない
    return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}
