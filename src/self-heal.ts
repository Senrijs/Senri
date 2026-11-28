/**
 * Self-healing per route (a circuit breaker). When a route keeps failing, only that route is paused for a while and
 * answered with 503 and `Retry-After`; the other routes keep working. After a while, one request is let through, and
 * the route is resumed when it succeeds.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { selfHeal } from "@senrijs/senri/self-heal";
 *
 * const app = createApp();
 * app.use(selfHeal());
 * app.use("/api/search", selfHeal({ slow: "2s" }));
 * ```
 *
 * @module
 */
// ルート単位のセルフヒール(サーキットブレーカー)
// 数える単位はルートの形(GET /users/:id)。止めているあいだは 503 + Retry-After(ProblemError を投げるので、本文は onError の形)
// 自分が返した 503 は数えない(数えると止まったまま戻らない)。/readyz とは連動しない(連動させると Pod ごと外される)
// 状態はプロセスごと。切り替わるたびにログを 1 行出し、/_senri とメトリクスにも出す
import type { Middleware } from "./context.ts";
import { senriError } from "./errors.ts";
import { terminalLang, type Lang } from "./lang.ts";
import { addNote } from "./notes.ts";
import { markPlainSafe, methodOf } from "./plain.ts";
import { ProblemError } from "./problem.ts";
import * as runtime from "./runtime.ts";
import { extraMetrics } from "./metrics-extra.ts";
import { healSnapshots, registerHealSource, type HealSnapshot, type HealState } from "./self-heal-state.ts";
import { SELF_HEAL_MESSAGES, type SelfHealMessageKey } from "./self-heal-messages.ts";

/** A duration: milliseconds as a number, or a string such as `"500ms"`, `"2s"` or `"1m"`. */
export type Duration = number | `${number}ms` | `${number}s` | `${number}m`;

/** Options for {@link selfHeal}. */
export type SelfHealOptions = {
    /** How far back requests are counted. Default `"30s"`. */
    window?: Duration;
    /** The route is paused only when at least this many requests were counted in `window`. Default `10`. */
    minRequests?: number;
    /** The route is paused when at least this share (more than 0, up to 1) of the counted requests failed. Default `0.5`. */
    threshold?: number;
    /** How long the route stays paused before one request is let through. Default `"10s"`. */
    cooldown?: Duration;
    /** Responses slower than this also count as failures. Default: not counted. */
    slow?: Duration;
    /** Where the lines about pausing and resuming go. Default `console.warn`. */
    log?: (line: string) => void;
};

// 窓を 10 個の入れ物に分けて数える(リクエストの数によらず、覚えておく量が一定)
const BUCKETS = 10;

type Bucket = { start: number; total: number; failed: number };

type Circuit = {
    method: string;
    route: string;
    state: HealState;
    buckets: Bucket[];
    // open: 止めた時刻 / half-open: 様子見の 1 件を通した時刻
    since: number;
    // 状態が変わるたびに増える(変わる前に始まったリクエストの結果は数えない)
    generation: number;
    // 様子見の 1 件の番号(結果が返ってきたとき、それがいまの様子見かを確かめる)
    probe: number;
    transitions: Record<HealState, number>;
    rejected: number;
};

// リクエストを受け持つ selfHeal()。2 つ重ねたときは、内側(あとに入ったほう)が上書きする
// 外側は、自分が受け持っていないリクエストを数えない(内側が返した 503 も、ここで外れる)
const owners = new WeakMap<object, object>();

const say = (lang: Lang, key: SelfHealMessageKey, params: Record<string, string | number> = {}) =>
    SELF_HEAL_MESSAGES[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));

const invalid = (what: string) => senriError("self_heal_options", new TypeError(`selfHeal(): ${what}`));

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000 };

// ミリ秒にする。読めなければ NaN
function toMs(value: Duration): number {
    if (typeof value === "number") return value;
    const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(value) : null;
    return match ? Number(match[1]) * UNITS[match[2]!]! : Number.NaN;
}

function duration(name: string, value: Duration | undefined, fallback: number | undefined): number | undefined {
    if (value === undefined) return fallback;
    const ms = toMs(value);
    if (!(Number.isFinite(ms) && ms > 0)) throw invalid(`${name} must be a positive duration, such as 2000 or "2s"`);
    return ms;
}

// 秒で見せる(小数は 1 桁まで)
const seconds = (ms: number) => String(Math.round(ms / 100) / 10);

// selfHeal() の状態を数にしたもの(senri_self_heal_state)
const HEAL_VALUE: Record<HealState, number> = { closed: 0, open: 1, "half-open": 2 };
const HEAL_LABEL: Record<HealState, string> = { closed: "closed", open: "open", "half-open": "half_open" };

// metricsHandler() に足す行。selfHeal() がいくつあっても、ルートごとにまとめて 1 回だけ出す
function healMetrics(escape: (value: string) => string): string[] {
    const heal = [...healSnapshots().values()];
    if (heal.length === 0) return [];
    const label = (h: HealSnapshot) => `method="${escape(h.method)}",route="${escape(h.route)}"`;
    const lines = [
        "# HELP senri_self_heal_state State of each route watched by selfHeal(): 0 running, 1 paused, 2 letting one request through.",
        "# TYPE senri_self_heal_state gauge",
    ];
    for (const h of heal) lines.push(`senri_self_heal_state{${label(h)}} ${HEAL_VALUE[h.state]}`);
    lines.push("# HELP senri_self_heal_transitions_total Times each route watched by selfHeal() entered a state.");
    lines.push("# TYPE senri_self_heal_transitions_total counter");
    for (const h of heal) {
        for (const state of ["open", "half-open", "closed"] as const) {
            lines.push(`senri_self_heal_transitions_total{${label(h)},to="${HEAL_LABEL[state]}"} ${h.transitions[state]}`);
        }
    }
    lines.push("# HELP senri_self_heal_rejected_total Requests answered with 503 by selfHeal() because the route was paused.");
    lines.push("# TYPE senri_self_heal_rejected_total counter");
    for (const h of heal) lines.push(`senri_self_heal_rejected_total{${label(h)}} ${h.rejected}`);
    return lines;
}

/**
 * Middleware that pauses a route that keeps failing (a circuit breaker), so one broken route does not take the rest of
 * the app down with it. Off unless you add it.
 *
 * - **Counted per route pattern** (`GET /users/:id`): if only `/users/7` keeps failing, `/users/:id` is paused as a
 *   whole. `HEAD` counts with `GET`. Requests that match no route (404, 405) are not counted
 * - **Failures**: 5xx responses (including a 503 your handler returns, and exceptions turned into 500 by `onError`),
 *   and responses slower than `slow` when it is given. The 503 that `selfHeal()` itself returns is never counted
 * - **Pausing**: when at least `minRequests` (10) requests were counted in the last `window` (30 s) and at least
 *   `threshold` (half) of them failed. A share, not a count, so a busy route is not paused by a few failures
 * - **While paused**: it throws a `ProblemError(503)` with `Retry-After`, so the body comes from `app.onError`
 *   (Problem Details with `problemDetails()`)
 * - **Resuming**: after `cooldown` (10 s), one request is let through. If it succeeds, the route is resumed; if it
 *   fails, the route stays paused for another `cooldown`. If that request does not finish within `cooldown`, the next
 *   one is let through instead
 * - **Shown**: one line each time a route is paused, probed or resumed (`log`, default `console.warn`), the state of
 *   each route in the `/_senri` dashboard, and `senri_self_heal_*` metrics in `metricsHandler()`
 *
 * With two `selfHeal()` on the same request (`app.use(selfHeal())` and `app.use("/api/search", selfHeal({ slow }))`),
 * the inner one (registered later, or in the route's `use`) counts that request and the outer one does not.
 *
 * **Types:** it declares `errors: 503`, so a typed client gets a typed 503 for routes that have it in their `use`
 * (`endpoint({ use: [selfHeal()] }, ...)` or `defineRoutes`). **Added with `app.use()`, the 503 does not appear in the
 * types until #160 lands. To get the type, add it in the route's `use`.**
 *
 * **What it cannot do:**
 * - The state lives in the process: with three instances, each one pauses on its own
 * - On Cloudflare Workers, instances are replaced often, so it has almost no effect. It warns at startup there
 * - Failures are known when the response is ready: an error while a streamed body is being sent is not counted
 * - It is not connected to `/readyz`: a paused route does not mark the instance as not ready (otherwise a load balancer
 *   or Kubernetes would take the whole instance out)
 *
 * Throws a `TypeError` when an option is not valid.
 *
 * @example
 * ```ts
 * import { createApp, endpoint, defineRoutes } from "@senrijs/senri";
 * import { selfHeal } from "@senrijs/senri/self-heal";
 *
 * const app = createApp();
 * // Every route, with the defaults
 * app.use(selfHeal());
 *
 * // In a route's use, the typed client also knows about the 503
 * const api = defineRoutes({
 *     "GET /api/search": endpoint({ use: [selfHeal({ slow: "2s" })] }, () => ({ hits: [] })),
 * });
 * app.routes(api);
 * ```
 */
// app.use() で付けたときは、#160 が入るまで 503 が型に出ない。型が欲しいときはルートの use で付ける
export function selfHeal(options: SelfHealOptions = {}): Middleware<any, { errors: 503 }> {
    if (typeof options !== "object" || options === null) throw invalid("pass an options object, or nothing");
    const window = duration("window", options.window, 30_000)!;
    const cooldown = duration("cooldown", options.cooldown, 10_000)!;
    const slow = duration("slow", options.slow, undefined);
    const minRequests = options.minRequests ?? 10;
    if (!(Number.isInteger(minRequests) && minRequests >= 1)) throw invalid("minRequests must be an integer of 1 or more");
    const threshold = options.threshold ?? 0.5;
    if (!(typeof threshold === "number" && threshold > 0 && threshold <= 1)) throw invalid("threshold must be a number greater than 0, up to 1");
    if (options.log !== undefined && typeof options.log !== "function") throw invalid("log must be a function");

    const lang = terminalLang();
    const log = options.log ?? ((line: string) => console.warn(line));
    const bucketMs = window / BUCKETS;
    const circuits = new Map<string, Circuit>();
    const token = {};

    // 使われたときにだけ、metricsHandler() に自分の行を足す(Set なので、何度呼んでも 1 つ)
    extraMetrics.add(healMetrics);
    registerHealSource(() =>
        [...circuits.values()].map(
            (c): HealSnapshot => ({ method: c.method, route: c.route, state: c.state, transitions: { ...c.transitions }, rejected: c.rejected }),
        ),
    );
    if (runtime.isWorkers()) log(`[senri] ${say(lang, "workers")}`);

    const tell = (key: SelfHealMessageKey, params: Record<string, string | number>) => log(`[senri] self-heal: ${say(lang, key, params)}`);
    const note = (c: object, key: SelfHealMessageKey, params: Record<string, string | number>) =>
        addNote(c, { layer: "selfHeal", tag: { en: say("en", "tag"), ja: say("ja", "tag") }, text: { en: say("en", key, params), ja: say("ja", key, params) } });

    const move = (circuit: Circuit, state: HealState, now: number) => {
        circuit.state = state;
        circuit.since = now;
        circuit.generation++;
        circuit.transitions[state]++;
        if (state === "closed") circuit.buckets = [];
    };

    // リクエストが終わったときに数える
    const settle = (circuit: Circuit, failed: boolean, probe: number | null, generation: number, now: number) => {
        const req = `${circuit.method} ${circuit.route}`;
        if (probe !== null) {
            // あとから別の様子見が始まっていたら、この結果は使わない
            if (circuit.state !== "half-open" || circuit.probe !== probe) return;
            move(circuit, failed ? "open" : "closed", now);
            if (failed) tell("reopened", { req, cooldown: seconds(cooldown) });
            else tell("closed", { req });
            return;
        }
        // 止める前に始まったリクエストの結果は数えない(止めている時間が延びないように)
        if (circuit.state !== "closed" || circuit.generation !== generation) return;
        const start = Math.floor(now / bucketMs) * bucketMs;
        circuit.buckets = circuit.buckets.filter((b) => b.start > now - window);
        let bucket = circuit.buckets.at(-1);
        if (bucket?.start !== start) circuit.buckets.push((bucket = { start, total: 0, failed: 0 }));
        bucket.total++;
        if (!failed) return;
        bucket.failed++;
        let total = 0;
        let failures = 0;
        for (const b of circuit.buckets) {
            total += b.total;
            failures += b.failed;
        }
        if (total >= minRequests && failures / total >= threshold) {
            move(circuit, "open", now);
            tell("opened", { req, failed: failures, total, window: seconds(window), cooldown: seconds(cooldown) });
        }
    };

    return markPlainSafe<Middleware<any, any>>(async function selfHeal(c, next) {
        const route = c.route;
        if (route === undefined) return next();
        owners.set(c, token);
        const raw = methodOf(c);
        const method = raw === "HEAD" ? "GET" : raw;
        const key = `${method} ${route}`;
        let circuit = circuits.get(key);
        if (!circuit) {
            circuit = { method, route, state: "closed", buckets: [], since: 0, generation: 0, probe: 0, transitions: { closed: 0, open: 0, "half-open": 0 }, rejected: 0 };
            circuits.set(key, circuit);
        }

        let probe: number | null = null;
        if (circuit.state !== "closed") {
            const now = Date.now();
            const waited = now - circuit.since;
            if (waited < cooldown) {
                // 止めている(様子見の 1 件が返ってくるのを待っている場合も)
                circuit.rejected++;
                const retryAfter = Math.max(1, Math.ceil((cooldown - waited) / 1000));
                note(c, "rejected", { req: key, seconds: retryAfter });
                throw new ProblemError(
                    503,
                    { detail: "This route is paused after repeated failures. Try again later." },
                    { headers: { "retry-after": String(retryAfter) } },
                );
            }
            // 待ち時間が過ぎたので、この 1 件を通して様子を見る(様子見の 1 件が返ってこないときも、次の 1 件を通す)
            if (circuit.state === "open") {
                move(circuit, "half-open", now);
                tell("probing", { req: key });
            } else {
                circuit.since = now;
            }
            probe = ++circuit.probe;
            note(c, "probe", { req: key });
        }

        const generation = circuit.generation;
        const start = Date.now();
        let failed = true;
        try {
            const res = await next();
            failed = res.status >= 500 || (slow !== undefined && Date.now() - start > slow);
            return res;
        } finally {
            // 内側の selfHeal() が受け持ったリクエストは数えない
            if (owners.get(c) === token) settle(circuit, failed, probe, generation, Date.now());
        }
    });
}
