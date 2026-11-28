// selfHeal() が見ているルートの状態の一覧。/_senri のダッシュボードと、selfHeal() が metricsHandler() に足す行が読む
// selfHeal() を使っていなければ空のまま(本体からは読み込まない)。状態はプロセスごと(Workers では isolate ごと)

// closed: 動いている / open: 止めている / half-open: 様子見(1 件だけ通している)
export type HealState = "closed" | "open" | "half-open";

// 1 つのルート(メソッドとルートの形)の、いまの状態と、これまでの数
export type HealSnapshot = {
    method: string;
    route: string;
    state: HealState;
    // その状態になった回数
    transitions: Record<HealState, number>;
    // 止めていたので 503 を返した数
    rejected: number;
};

// selfHeal() を呼ぶたびに 1 つ増える(それぞれが自分のルートの状態を持つ)
const sources = new Set<() => Iterable<HealSnapshot>>();

export function registerHealSource(source: () => Iterable<HealSnapshot>): void {
    sources.add(source);
}

// 悪いほうを残す(同じルートを 2 つの selfHeal() が見ていたとき)
const RANK: Record<HealState, number> = { closed: 0, "half-open": 1, open: 2 };

// ルートごとにまとめたもの。キーは "GET /users/:id"
export function healSnapshots(): Map<string, HealSnapshot> {
    const out = new Map<string, HealSnapshot>();
    for (const source of sources) {
        for (const s of source()) {
            const key = `${s.method} ${s.route}`;
            const seen = out.get(key);
            if (!seen) {
                out.set(key, { ...s, transitions: { ...s.transitions } });
                continue;
            }
            if (RANK[s.state] > RANK[seen.state]) seen.state = s.state;
            for (const state of Object.keys(RANK) as HealState[]) seen.transitions[state] += s.transitions[state];
            seen.rejected += s.rejected;
        }
    }
    return out;
}

// テストのため: これまでの selfHeal() を一覧から外す
export function clearHealSources(): void {
    sources.clear();
}
