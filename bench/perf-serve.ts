// 速度の調査(docs/design/perf-0.3.md)用のサーバー。ランタイムを見て立て方を変える
//   bun perf-serve.ts <target> <scenario> <port>
//   node perf-serve.ts <target> <scenario> <port>
//   deno run -A perf-serve.ts <target> <scenario> <port>
// target:
//   senri        … 今の src
//   senri@0.2.9  … VERSIONS_DIR に npm から別名(senri-0.2.9)で入れた版
//   hono         … Hono(Node では @hono/node-server)
//   raw          … フレームワークなし。上限の目安(ここに Hono が近ければ、数字が頭打ちになっている)
// scenario: static / param / mw(bench/scenarios.ts)
// 立て方は bench/http.ts と同じ: Bun.serve({ fetch }) / Deno.serve(fetch) / Node は各フレームワークの勧める形
import { honoScenario, loadSenri, senriScenario, SCENARIOS, type ScenarioName } from "./scenarios.ts";

const g = globalThis as any;
const args: string[] = g.Deno ? g.Deno.args : g.process.argv.slice(2);
const env = (name: string): string | undefined => (g.Deno ? g.Deno.env.get(name) : g.process.env[name]);
const [target, scenario, portText] = args as [string, ScenarioName, string];
if (!target || !SCENARIOS.includes(scenario) || !portText) {
    throw new Error("使い方: perf-serve.ts <senri|senri@版|hono|raw> <static|param|mw> <port>");
}
const port = Number(portText);
const hostname = "127.0.0.1";
const ready = () => console.log("ready");
const runtime: "bun" | "deno" | "node" = g.Bun ? "bun" : g.Deno ? "deno" : "node";

// フレームワークなしの答え。static は "hi"、ほかは /users/:id の JSON
function rawBody(path: string): { body: string; type: string } | null {
    if (scenario === "static") return path === "/" ? { body: "hi", type: "text/plain; charset=utf-8" } : null;
    const m = /^\/users\/([^/]+)$/.exec(path);
    return m ? { body: JSON.stringify({ id: m[1] }), type: "application/json" } : null;
}
const pathOf = (url: string) => {
    const start = url.indexOf("/", url.indexOf("//") + 2);
    const end = url.indexOf("?", start);
    return end === -1 ? url.slice(start) : url.slice(start, end);
};
const rawFetch = (req: Request) => {
    const hit = rawBody(pathOf(req.url));
    return hit ? new Response(hit.body, { headers: { "content-type": hit.type } }) : new Response("Not Found", { status: 404 });
};

const version = target.startsWith("senri@") ? target.slice("senri@".length) : target === "senri" ? "src" : null;

if (runtime === "node") {
    if (version !== null) {
        const mod = await loadSenri(version, env("VERSIONS_DIR"));
        const { app } = senriScenario(mod, scenario);
        // アダプターも同じ版のものを使う
        const adapter =
            version === "src"
                ? await import("../adapters/node/index.ts")
                : await import(new URL(`file:///${env("VERSIONS_DIR")!.replaceAll("\\", "/").replace(/^\//, "").replace(/\/$/, "")}/node_modules/senri-${version}/dist/adapters/node/index.js`).href);
        adapter.serve(app, { port, hostname }).once("listening", ready);
    } else if (target === "hono") {
        const { serve } = await import("@hono/node-server");
        serve({ fetch: honoScenario(scenario).fetch, port, hostname }, ready);
    } else if (target === "raw") {
        const { createServer } = await import("node:http");
        createServer((req, res) => {
            const hit = rawBody(pathOf(`http://${hostname}${req.url ?? "/"}`));
            res.writeHead(hit ? 200 : 404, { "content-type": hit?.type ?? "text/plain; charset=utf-8" });
            res.end(hit?.body ?? "Not Found");
        }).listen(port, hostname, ready);
    } else {
        throw new Error(`知らない target: ${target}`);
    }
} else {
    let fetch: (req: Request) => Response | Promise<Response>;
    if (version !== null) fetch = senriScenario(await loadSenri(version, env("VERSIONS_DIR")), scenario).fetch;
    else if (target === "hono") fetch = honoScenario(scenario).fetch;
    else if (target === "raw") fetch = rawFetch;
    else throw new Error(`知らない target: ${target}`);
    if (runtime === "bun") {
        g.Bun.serve({ port, hostname, fetch });
        ready();
    } else {
        g.Deno.serve({ port, hostname, onListen: ready }, fetch);
    }
}
