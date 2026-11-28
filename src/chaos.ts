/**
 * Chaos mode for development: slows down some requests, answers some with an error status, and throws in some, on
 * purpose, so you can see how your app and its clients behave before it happens in production.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { chaos } from "@senrijs/senri/chaos";
 *
 * const app = createApp();
 * app.use(chaos({
 *     enabled: true,
 *     seed: 42,
 *     latency: { rate: 0.1, ms: [200, 2000] },
 *     errors: { rate: 0.05, status: [500, 503] },
 *     throws: { rate: 0.02 },
 * }));
 * ```
 *
 * @module
 */
// カオスモード。開発中に、わざと遅延・エラーの状態コード・例外を混ぜる
// 本番では動かない: enabled: true がないと何もしない / NODE_ENV=production ならエラーで止める / 動くときは起動時に大きく警告する
// 何をしたかは 1 リクエストにつき 1 行のログと、/_senri の玉ねぎタイムラインに出す
import type { Middleware } from "./context.ts";
import { senriError } from "./errors.ts";
import { terminalLang, type Lang } from "./lang.ts";
import { CHAOS_MESSAGES, type ChaosMessageKey } from "./chaos-messages.ts";
import { addNote } from "./notes.ts";
import { headerOf, markPlainSafe, methodOf, urlOf } from "./plain.ts";
import { ProblemError } from "./problem.ts";
import * as runtime from "./runtime.ts";

/** Options for {@link chaos}. */
export type ChaosOptions = {
    // true と書いたときだけ動く(環境変数の "true" などの文字列では動かない)
    /** Chaos runs only when this is `true`. Anything else (including the string `"true"`) leaves it off. */
    enabled: boolean;
    // 同じ種なら、同じ順番で届いたリクエストが同じように壊れる。省くと毎回ちがう種にして、起動時の警告に出す
    /**
     * The seed of the random choices. With the same seed, requests arriving in the same order are broken the same way.
     * Without it, a random seed is used and printed at startup, so you can pass it to repeat a run.
     */
    seed?: number;
    /** Delays `rate` (0 to 1) of the requests by `ms` milliseconds, or by a random time in `[min, max]`. */
    latency?: { rate: number; ms: number | readonly [number, number] };
    /** Answers `rate` (0 to 1) of the requests with `status` (400 to 599), or with one of the statuses at random. */
    errors?: { rate: number; status: number | readonly number[] };
    /** Throws an exception in `rate` (0 to 1) of the requests, as a bug in a handler would. */
    throws?: { rate: number };
    /** Where the lines about what chaos does go. Default `console.warn`. */
    log?: (line: string) => void;
};

// setTimeout に渡せる最大
const MAX_MS = 2 ** 31 - 1;

// 1 件のリクエストに何をするか
type Plan = { latency: number; status: number | null; threw: boolean };

const say = (lang: Lang, key: ChaosMessageKey, params: Record<string, string | number> = {}) =>
    CHAOS_MESSAGES[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));

const isRate = (rate: unknown) => typeof rate === "number" && rate >= 0 && rate <= 1;
const isMs = (ms: unknown): ms is number => typeof ms === "number" && Number.isInteger(ms) && ms >= 0 && ms <= MAX_MS;
const isStatus = (status: unknown): status is number => typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599;

const invalid = (what: string) => senriError("chaos_options", new TypeError(`chaos(): ${what}`));

// オプションを確かめて、扱いやすい形にする
function normalize(options: ChaosOptions) {
    if (typeof options !== "object" || options === null) throw invalid("pass an options object, such as { enabled: true }");
    const { latency, errors, throws, seed, log } = options;
    if (latency !== undefined) {
        if (!isRate(latency?.rate)) throw invalid("latency.rate must be a number from 0 to 1");
        const ms = latency.ms;
        const valid = isMs(ms) || (Array.isArray(ms) && ms.length === 2 && isMs(ms[0]) && isMs(ms[1]) && ms[0] <= ms[1]);
        if (!valid) throw invalid("latency.ms must be milliseconds (an integer of 0 or more), or [min, max] with min <= max");
    }
    if (errors !== undefined) {
        if (!isRate(errors?.rate)) throw invalid("errors.rate must be a number from 0 to 1");
        const list = typeof errors.status === "number" ? [errors.status] : errors.status;
        if (!Array.isArray(list) || list.length === 0 || !list.every(isStatus)) throw invalid("errors.status must be a status from 400 to 599, or a non-empty array of them");
    }
    if (throws !== undefined && !isRate(throws?.rate)) throw invalid("throws.rate must be a number from 0 to 1");
    if (seed !== undefined && !(typeof seed === "number" && Number.isInteger(seed))) throw invalid("seed must be an integer");
    if (log !== undefined && typeof log !== "function") throw invalid("log must be a function");

    const range: readonly [number, number] = latency ? (typeof latency.ms === "number" ? [latency.ms, latency.ms] : [latency.ms[0], latency.ms[1]]) : [0, 0];
    return {
        latencyRate: latency?.rate ?? 0,
        range,
        errorRate: errors?.rate ?? 0,
        statuses: errors ? (typeof errors.status === "number" ? [errors.status] : [...errors.status]) : [],
        throwRate: throws?.rate ?? 0,
    };
}

// 種から 0 以上 1 未満の数を順に作る(mulberry32)。Math.random と違って、同じ種なら同じ列になる
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// X-Senri-Chaos ヘッダーを読む。読めなければ、何が読めなかったかの文字列を返す
// latency=2000 / status=503 / throw / none。カンマで並べられる(none はひとつだけで)
function parseChaosHeader(value: string): Plan | string {
    const plan: Plan = { latency: 0, status: null, threw: false };
    const seen = new Set<string>();
    const parts = value.split(",").map((part) => part.trim().toLowerCase());
    for (const part of parts) {
        const [key, arg, ...rest] = part.split("=").map((s) => s.trim());
        if (!key || rest.length > 0) return `cannot read "${part}"`;
        if (seen.has(key)) return `"${key}" is given twice`;
        seen.add(key);
        if (key === "none" || key === "throw") {
            if (arg !== undefined) return `"${key}" takes no value`;
            if (key === "throw") plan.threw = true;
        } else if (key === "latency") {
            const ms = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : NaN;
            if (!isMs(ms)) return `latency must be milliseconds, such as latency=2000`;
            plan.latency = ms;
        } else if (key === "status") {
            const status = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : NaN;
            if (!isStatus(status)) return `status must be from 400 to 599, such as status=503`;
            plan.status = status;
        } else {
            return `unknown "${key}" (use latency=<ms>, status=<400-599>, throw or none)`;
        }
    }
    if (seen.has("none") && seen.size > 1) return `"none" cannot be combined with others`;
    if (plan.threw && plan.status !== null) return `"throw" and "status" cannot be combined`;
    return plan;
}

// ログに出すパス(届いたまま。クエリには秘密が入っていることがあるので出さない)
function pathOf(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

const percent = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/**
 * Middleware that breaks requests on purpose, for development: it delays some, answers some with an error status, and
 * throws in some. It runs before the rest of the chain: a request that gets an error status or an exception does not
 * reach the handler.
 *
 * **It never runs in production:**
 * - It does nothing unless `enabled` is `true`
 * - With `enabled: true`, it throws at startup when `NODE_ENV` is `production`, or when `NODE_ENV` cannot be read
 *   (Deno without `--allow-env=NODE_ENV`). On Cloudflare Workers and in the browser, where `NODE_ENV` is not
 *   available, it runs and warns that it cannot check
 * - While it runs, it prints a warning at startup with what it will do and the seed
 *
 * **What it does is shown:** one line per broken request (`log`, default `console.warn`), and in the `/_senri`
 * dashboard's timeline.
 *
 * **Choosing requests:** at random, by `rate`. With `seed`, requests arriving in the same order are broken the same way
 * (concurrent requests take the order they arrive in). A request with the `X-Senri-Chaos` header is broken exactly as
 * the header says, ignoring the rates: `latency=2000` (milliseconds), `status=503`, `throw`, or `none` to leave it
 * alone, comma-separated, as in `latency=500, status=503`. A header that cannot be read is answered with 400.
 *
 * - An error status is an `HttpError` (a `ProblemError`), and an exception is a plain `Error`: both go to `app.onError`
 *   like real ones, so the response has your app's error format (Problem Details with `problemDetails()`)
 * - **The statuses are not added to types.** They happen only in development, so the typed client and OpenAPI do not
 *   include them
 *
 * Throws a `TypeError` when an option is not valid: rates are from 0 to 1, `latency.ms` is milliseconds or `[min, max]`,
 * `errors.status` is from 400 to 599 (or an array of them), and `seed` is an integer.
 *
 * @example
 * ```ts
 * import { createApp } from "@senrijs/senri";
 * import { chaos } from "@senrijs/senri/chaos";
 *
 * const app = createApp();
 * // Turn it on only when you ask for it
 * app.use(chaos({
 *     enabled: process.env.CHAOS === "1",
 *     latency: { rate: 0.1, ms: [200, 2000] },
 *     errors: { rate: 0.05, status: 503 },
 * }));
 *
 * // In a test or a demo: curl -H "X-Senri-Chaos: status=503" http://localhost:3000/
 * ```
 */
export function chaos(options: ChaosOptions): Middleware {
    const config = normalize(options);
    if (options.enabled !== true) return markPlainSafe<Middleware>(function chaos(_c, next) {
        return next();
    });

    // 本番の守り。読めないときも、本番かもしれないので止める
    if (!runtime.canReadEnv("NODE_ENV")) {
        throw senriError("chaos_env_unreadable", "chaos(): NODE_ENV is not readable, so it cannot check that this is not production. Run with --allow-env=NODE_ENV");
    }
    if (runtime.env("NODE_ENV") === "production") {
        throw senriError("chaos_production", "chaos(): enabled is true but NODE_ENV is production. Chaos never runs in production; remove it or set enabled: false");
    }

    const lang = terminalLang();
    const log = options.log ?? ((line: string) => console.warn(line));
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
    const random = seededRandom(seed);

    // 起動時の警告(何をするかと、種)
    const [min, max] = config.range;
    const lines = [say(lang, "on")];
    if (config.latencyRate > 0) lines.push(`  ${say(lang, "latency", { rate: percent(config.latencyRate), ms: min === max ? `${min} ms` : `${min}-${max} ms` })}`);
    if (config.errorRate > 0) lines.push(`  ${say(lang, "errors", { rate: percent(config.errorRate), status: config.statuses.join(", ") })}`);
    if (config.throwRate > 0) lines.push(`  ${say(lang, "throws", { rate: percent(config.throwRate) })}`);
    lines.push(`  ${say(lang, "seed", { seed })}`, `  ${say(lang, "header")}`);
    // Workers とブラウザでは NODE_ENV が読めない(devtools() と同じ見分け方)
    if (runtime.isWorkers() || typeof (globalThis as { process?: unknown }).process === "undefined") lines.push(`  ${say(lang, "unknownEnv")}`);
    for (const line of lines) log(`[senri] ${line}`);

    // 毎回同じ数だけ引く(割合を 1 つ変えても、ほかの壊れ方の順番がずれないように。ヘッダーで決めたときも引く)
    const draw = (): Plan => {
        const [a, b, c, d, e] = [random(), random(), random(), random(), random()];
        const latency = a < config.latencyRate ? min + Math.floor(b * (max - min + 1)) : 0;
        const threw = e < config.throwRate;
        const status = !threw && c < config.errorRate ? config.statuses[Math.floor(d * config.statuses.length)]! : null;
        return { latency, status, threw };
    };

    return markPlainSafe<Middleware>(async function chaos(c, next) {
        const drawn = draw();
        const header = headerOf(c, "x-senri-chaos");
        const plan = header === null ? drawn : parseChaosHeader(header);
        if (typeof plan === "string") {
            throw new ProblemError(400, { title: "Bad X-Senri-Chaos header", detail: `X-Senri-Chaos: ${plan}` });
        }
        if (plan.latency === 0 && plan.status === null && !plan.threw) return next();

        const req = `${methodOf(c)} ${pathOf(urlOf(c))}`;
        const key = plan.latency > 0 ? (plan.threw ? "delayedThrew" : plan.status !== null ? "delayedResponded" : "delayed") : plan.threw ? "threw" : "responded";
        const params = { req, ms: plan.latency, status: plan.status ?? "" };
        const text = (l: Lang) => say(l, key, params) + (header === null ? "" : say(l, "byHeader"));
        log(`[senri] chaos: ${text(lang)}`);
        addNote(c, { layer: "chaos", tag: { en: say("en", "tag"), ja: say("ja", "tag") }, text: { en: text("en"), ja: text("ja") } });

        if (plan.latency > 0) await new Promise((resolve) => setTimeout(resolve, plan.latency));
        if (plan.threw) throw senriError("chaos_throw", "chaos(): an exception thrown on purpose");
        if (plan.status !== null) throw new ProblemError(plan.status, { detail: "Injected by chaos() on purpose" });
        return next();
    });
}
