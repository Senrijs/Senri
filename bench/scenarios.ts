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

// 期待どおりの本文と status か。だめなら理由を返す
export async function checkScenario(res: Response, scenario: ScenarioName): Promise<string | null> {
    const body = await res.text();
    if (res.status !== 200) return `200 のはずが ${res.status}`;
    if (body !== SCENARIO_REQUESTS[scenario].body) return `本文が ${JSON.stringify(body.slice(0, 60))}`;
    if (scenario === "mw" && !res.headers.get("x-request-id")) return "x-request-id がない";
    return null;
}

// 今の src か、VERSIONS_DIR(npm から別名 senri-<版> で入れたフォルダー)の版を読み込む
// "src" なら今のリポジトリ。版の名前("0.2.9")なら <VERSIONS_DIR>/node_modules/senri-<版>/dist/src/index.js
export async function loadSenri(version: string, versionsDir: string | undefined): Promise<SenriModule> {
    if (version === "src") return (await import("../src/index.ts")) as unknown as SenriModule;
    if (!versionsDir) throw new Error(`版 ${version} を読むには VERSIONS_DIR が要ります(bench/README.md の「版ごとに比べる」)`);
    const base = versionsDir.replaceAll("\\", "/").replace(/\/$/, "");
    const url = new URL(`file:///${base.replace(/^\//, "")}/node_modules/senri-${version}/dist/src/index.js`);
    return (await import(url.href)) as SenriModule;
}
