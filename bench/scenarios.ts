// 速度の調査(docs/design/perf-0.3.md)で使う 3 つのシナリオ。Senri の版ごと・Hono で同じものを作る
// - static: GET / で文字列を返す
// - param: GET /users/:id で JSON を返す
// - mw: requestId + cors + 小さな自前ミドルウェア 1 つ。GET /users/:id で JSON を返す
// Senri は、読み込んだモジュール(今の src、または npm から入れた古い版)を渡して作る
// どのランタイムでも動くように、Bun / Deno / Node だけの API は使わない
import { Hono } from "hono";
import { cors as honoCors } from "hono/cors";
import { requestId as honoRequestId } from "hono/request-id";

export type ScenarioName = "static" | "param" | "mw";
export const SCENARIOS: ScenarioName[] = ["static", "param", "mw"];

// [シナリオ, 測るパス, 期待する本文]
export const SCENARIO_REQUESTS: Record<ScenarioName, { path: string; body: string }> = {
    static: { path: "/", body: "hi" },
    param: { path: "/users/42", body: '{"id":"42"}' },
    mw: { path: "/users/42", body: '{"id":"42"}' },
};

export type FetchApp = { name: string; fetch: (req: Request) => Response | Promise<Response>; app?: unknown };

// Senri のモジュールのうち、使う部分だけ(古い版にも合うよう、型はゆるくする)
export type SenriModule = {
    createApp: () => any;
    cors: (options?: object) => any;
    requestId?: () => any;
};

// requestId がない版(0.2.12 より前)の代わり。同じことをする(ID を作って c.set と c.header)
const requestIdFallback = () =>
    async function requestId(c: any, next: () => Promise<Response>) {
        const id = crypto.randomUUID();
        c.set("requestId", id);
        c.header("x-request-id", id);
        return next();
    };

// 小さな自前ミドルウェア(利用者が書きそうなもの。ヘッダーを 1 つ足すだけ)
const poweredBy = async function poweredBy(c: any, next: () => Promise<Response>) {
    c.header("x-powered-by", "bench");
    return next();
};

export function senriScenario(mod: SenriModule, scenario: ScenarioName, name = "senri"): FetchApp {
    const app = mod.createApp();
    if (scenario === "mw") {
        app.use((mod.requestId ?? requestIdFallback)());
        app.use(mod.cors());
        app.use(poweredBy);
    }
    if (scenario === "static") app.get("/", () => "hi");
    else app.get("/users/:id", ({ id }: { id: string }) => ({ id }));
    return { name, fetch: (req) => app.fetch(req), app };
}

export function honoScenario(scenario: ScenarioName): FetchApp {
    const app = new Hono();
    if (scenario === "mw") {
        app.use(honoRequestId());
        app.use(honoCors());
        app.use(async (c, next) => {
            c.header("x-powered-by", "bench");
            await next();
        });
    }
    if (scenario === "static") app.get("/", (c) => c.text("hi"));
    else app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
    return { name: "hono", fetch: (req) => app.fetch(req) };
}

// Hono との差の原因を切り分けるための、Hono の変種(src に手を入れずに、仮説を 1 つずつ確かめる)
// - hono-async: fetch を async で包み、いつも Promise を返す(Senri の app.fetch と同じ)。Promise の分の差を見る
// - hono-init: ハンドラーが Senri と同じ形の Response を返す(status と、使い回す Headers を渡す)
//   Hono の c.text("hi") は new Response(text) と init なしで作るので、Response の作り方の分の差を見る
const TEXT_HEADERS = new Headers({ "content-type": "text/plain; charset=utf-8" });
const JSON_HEADERS = new Headers({ "content-type": "application/json" });
export const HONO_VARIANTS = ["hono-async", "hono-init"] as const;

export function honoVariant(name: (typeof HONO_VARIANTS)[number], scenario: ScenarioName): FetchApp {
    if (name === "hono-async") {
        const { fetch } = honoScenario(scenario);
        return { name, fetch: async (req) => fetch(req) };
    }
    if (scenario === "mw") throw new Error("hono-init は static と param だけ");
    const app = new Hono();
    if (scenario === "static") app.get("/", () => new Response("hi", { status: 200, headers: TEXT_HEADERS }));
    else app.get("/users/:id", (c) => new Response(JSON.stringify({ id: c.req.param("id") }), { status: 200, headers: JSON_HEADERS }));
    return { name, fetch: (req) => app.fetch(req) };
}

// 期待どおりの本文と status か。だめなら理由を返す
export async function checkScenario(res: Response, scenario: ScenarioName): Promise<string | null> {
    const body = await res.text();
    if (res.status !== 200) return `200 のはずが ${res.status}`;
    if (body !== SCENARIO_REQUESTS[scenario].body) return `本文が ${JSON.stringify(body.slice(0, 60))}`;
    if (scenario === "mw" && !res.headers.get("x-request-id")) return "x-request-id がない";
    return null;
}

// 今の src か、VERSIONS_DIR(npm から別名 senri-<版> で入れたフォルダー)の版か、REF_DIR(git archive で取り出した別のブランチ)を読み込む
// - "src" なら今のリポジトリ
// - "ref" なら <REF_DIR>/src/index.ts。TS のまま読む(node_modules の外なので、Node も型を外して読める)
// - 版の名前("0.2.9")なら <VERSIONS_DIR>/node_modules/senri-<版>/dist/src/index.js
export async function loadSenri(version: string, versionsDir: string | undefined, refDir?: string): Promise<SenriModule> {
    if (version === "src") return (await import("../src/index.ts")) as unknown as SenriModule;
    return (await import(senriFileUrl(version, versionsDir, refDir, "src/index"))) as SenriModule;
}

// 版ごとのファイルの場所(Node のアダプターも、同じ版のものを使うため)
export function senriFileUrl(version: string, versionsDir: string | undefined, refDir: string | undefined, file: "src/index" | "adapters/node/index"): string {
    const fileUrl = (dir: string, path: string) => new URL(`file:///${dir.replaceAll("\\", "/").replace(/^\//, "").replace(/\/$/, "")}/${path}`).href;
    if (version === "ref") {
        if (!refDir) throw new Error("senri@ref を読むには REF_DIR が要ります(bench/perf-vm.sh の compare)");
        return fileUrl(refDir, `${file}.ts`);
    }
    if (!versionsDir) throw new Error(`版 ${version} を読むには VERSIONS_DIR が要ります(bench/README.md の「版ごとに比べる」)`);
    return fileUrl(versionsDir, `node_modules/senri-${version}/dist/${file}.js`);
}
