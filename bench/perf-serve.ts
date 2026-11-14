// 速度の調査(docs/design/perf-0.3.md)用のサーバー。ランタイムを見て立て方を変える
//   bun perf-serve.ts <target> <scenario> <port>
//   node perf-serve.ts <target> <scenario> <port>
//   deno run -A perf-serve.ts <target> <scenario> <port>
// target:
//   senri        … 今の src
//   senri@0.2.9  … VERSIONS_DIR に npm から別名(senri-0.2.9)で入れた版
//   senri@ref    … REF_DIR に git archive で取り出した、別のブランチの src(perf-vm.sh の compare)
//   hono         … Hono(Node では @hono/node-server)
//   hono-async / hono-init … 差の原因を切り分けるための Hono の変種(bench/scenarios.ts の honoVariant)
//   raw          … フレームワークなし。同期で "ok" を返すだけの、上限の目安(ここに Hono が近ければ、数字が頭打ちになっている)
// scenario: static / param / mw(bench/scenarios.ts)
// 立て方は bench/http.ts と同じ: Bun.serve({ fetch }) / Deno.serve(fetch) / Node は各フレームワークの勧める形
import { HONO_VARIANTS, honoScenario, honoVariant, loadSenri, senriFileUrl, senriScenario, SCENARIOS, type ScenarioName } from "./scenarios.ts";

const g = globalThis as any;
const args: string[] = g.Deno ? g.Deno.args : g.process.argv.slice(2);
const env = (name: string): string | undefined => (g.Deno ? g.Deno.env.get(name) : g.process.env[name]);
const [target, scenario, portText] = args as [string, ScenarioName, string];
if (!target || !SCENARIOS.includes(scenario) || !portText) {
    throw new Error("使い方: perf-serve.ts <senri|senri@版|hono|hono-async|hono-init|raw> <static|param|mw> <port>");
}
const port = Number(portText);
const hostname = "127.0.0.1";
const ready = () => console.log("ready");
const runtime: "bun" | "deno" | "node" = g.Bun ? "bun" : g.Deno ? "deno" : "node";

// フレームワークなしの上限の目安。パスもシナリオも見ず、同期でいちばん小さい答えを返す(async にしない)
// 本文は "ok" で、シナリオの期待と違うので、perf-abab.ts は raw の本文を確かめない
const rawFetch = () => new Response("ok");

const version = target.startsWith("senri@") ? target.slice("senri@".length) : target === "senri" ? "src" : null;

if (runtime === "node") {
    if (version !== null) {
        const mod = await loadSenri(version, env("VERSIONS_DIR"), env("REF_DIR"));
        const { app } = senriScenario(mod, scenario);
        // アダプターも同じ版のものを使う
        const adapter =
            version === "src"
                ? await import("../adapters/node/index.ts")
                : await import(senriFileUrl(version, env("VERSIONS_DIR"), env("REF_DIR"), "adapters/node/index"));
        adapter.serve(app, { port, hostname }).once("listening", ready);
    } else if (target === "hono" || (HONO_VARIANTS as readonly string[]).includes(target)) {
        const { serve } = await import("@hono/node-server");
        const app = target === "hono" ? honoScenario(scenario) : honoVariant(target as (typeof HONO_VARIANTS)[number], scenario);
        serve({ fetch: app.fetch, port, hostname }, ready);
    } else if (target === "raw") {
        const { createServer } = await import("node:http");
        createServer((_req, res) => res.end("ok")).listen(port, hostname, ready);
    } else {
        throw new Error(`知らない target: ${target}`);
    }
} else {
    let fetch: (req: Request) => Response | Promise<Response>;
    if (version !== null) fetch = senriScenario(await loadSenri(version, env("VERSIONS_DIR"), env("REF_DIR")), scenario).fetch;
    else if (target === "hono") fetch = honoScenario(scenario).fetch;
    else if ((HONO_VARIANTS as readonly string[]).includes(target)) fetch = honoVariant(target as (typeof HONO_VARIANTS)[number], scenario).fetch;
    else if (target === "raw") fetch = rawFetch;
    else throw new Error(`知らない target: ${target}`);
    if (runtime === "bun") {
        g.Bun.serve({ port, hostname, fetch });
        ready();
    } else {
        g.Deno.serve({ port, hostname, onListen: ready }, fetch);
    }
}

// プロファイルを取るとき(perf-profile-http.ts が PROFILE_MS を渡す)。ふつうに測るときは何もしない
// 立ってから PROFILE_WARMUP_MS(既定 1000)待って取り始め、PROFILE_MS たったら終わる
// - PROFILE_OUT があれば node:inspector で取って書く(Deno には --cpu-prof がないため。perf-profile-http.ts は Deno だけに渡す)
// - Node と Bun は --cpu-prof で取る。プロファイルは、ここで process.exit したときに書かれる
const profileMs = Number(env("PROFILE_MS") ?? "0");
if (profileMs > 0) {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(Number(env("PROFILE_WARMUP_MS") ?? "1000"));
    const out = env("PROFILE_OUT");
    if (out) {
        const { Session } = await import("node:inspector/promises");
        const { writeFileSync } = await import("node:fs");
        const session = new Session();
        session.connect();
        await session.post("Profiler.enable");
        await session.post("Profiler.setSamplingInterval", { interval: Number(env("PROFILE_INTERVAL_US") ?? "1000") });
        await session.post("Profiler.start");
        await sleep(profileMs);
        const { profile } = (await session.post("Profiler.stop")) as { profile: unknown };
        writeFileSync(out, JSON.stringify(profile));
    } else {
        await sleep(profileMs);
    }
    console.log("profiled");
    if (g.Deno) g.Deno.exit(0);
    else g.process.exit(0);
}
