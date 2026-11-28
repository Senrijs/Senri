// selfHeal() がターミナルと /_senri に出す文言。en を元にして、ja は同じキーを必ず持つ
import type { Lang } from "./lang.ts";

const en = {
    opened: "paused {req}: {failed} of {total} requests failed in the last {window} s. It will let one request through in {cooldown} s.",
    probing: "probing {req}: letting one request through",
    closed: "resumed {req}: the probe request succeeded",
    reopened: "{req} still fails, so it stays paused. It will let one request through in {cooldown} s.",
    workers: "selfHeal() keeps its state in each instance. On Cloudflare Workers, instances are replaced often, so it has almost no effect.",
    rejected: "responded 503: {req} is paused (Retry-After: {seconds} s)",
    probe: "let this request through as the probe of {req}",
    tag: "self-heal",
};

/** A key of the messages of `selfHeal()`. */
export type SelfHealMessageKey = keyof typeof en;

const ja: Record<SelfHealMessageKey, string> = {
    opened: "{req} を止めた(直近 {window} 秒で {total} 件中 {failed} 件失敗)。{cooldown} 秒後に 1 件だけ通して様子を見ます",
    probing: "{req} の様子を見る(1 件だけ通す)",
    closed: "{req} を戻した(様子見の 1 件が成功した)",
    reopened: "{req} はまだ失敗するので、止めたままにする。{cooldown} 秒後にまた 1 件だけ通します",
    workers: "selfHeal() の状態はインスタンスごとです。Cloudflare Workers ではインスタンスがすぐ入れ替わるため、ほぼ効きません",
    rejected: "{req} を止めているので 503 を返した(Retry-After: {seconds} 秒)",
    probe: "{req} の様子見の 1 件として通した",
    tag: "セルフヒール",
};

export const SELF_HEAL_MESSAGES: Record<Lang, Record<SelfHealMessageKey, string>> = { en, ja };
