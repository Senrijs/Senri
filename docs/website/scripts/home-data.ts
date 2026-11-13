// トップページで使うデータを作って lib/home/generated.json に書き出す。next build と next dev の前に bun で動かす
// - CLI のログ: リポジトリの本物の logger() と showRoutes() を動かして、出力をそのまま記録する(形がずれないように)
// - プレイグラウンド: 最初のコードを本物の Senri で動かした結果(ブラウザで動かす版ができるまでの見本)
// - バージョン: リポジトリの package.json
// - GitHub のスター数と npm の週間ダウンロード数: トークンなしの API。取れなければ null(ページでは数字を出さない)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as senri from "../../../src/index.ts";
import { devtools } from "../../../src/dev/index.ts";
import { hintFor } from "../../../src/dev/hints.ts";
import { hintCode, hintText } from "../../../src/dev/messages.ts";
import { SERVE_MESSAGES } from "../../../adapters/serve/messages.ts";
import { DEFAULT_PORT } from "../../../adapters/serve/port.ts";
import { BOOM_PATH, PLAYGROUND_CODE, QUICK_PATHS } from "../lib/home/playground-code.ts";
import type { HomeData, Line, LogEntry, Recording, Segment, Tone } from "../lib/home/types.ts";

const WEBSITE = join(import.meta.dirname, "..");
const ROOT = join(WEBSITE, "..", "..");
const LANGS = ["ja", "en"] as const;

// --- ANSI のエスケープを、色の名前つきの区切りにする ---

const TONES: Record<string, Tone> = {
    "2": "dim",
    "1": "bold",
    "31": "red",
    "32": "green",
    "33": "yellow",
    "35": "magenta",
    "36": "cyan",
    "38;2;227;65;43": "accent",
};

// 複数の行をまとめて読む(エラーのスタックのように、色が行をまたぐことがある)
function parseAnsi(text: string): Line[] {
    const lines: Line[] = [[]];
    let tone: Tone | undefined;
    for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
        const code = /^\x1b\[([0-9;]*)m$/.exec(part)?.[1];
        if (code !== undefined) {
            tone = code === "0" ? undefined : TONES[code];
            continue;
        }
        part.split("\n").forEach((piece, i) => {
            if (i > 0) lines.push([]);
            if (piece !== "") lines.at(-1)!.push(tone ? { text: piece, tone } : { text: piece });
        });
    }
    return lines;
}

// console.log に出たものを集める
async function capture(run: () => unknown): Promise<string[]> {
    const out: string[] = [];
    const log = console.log;
    const warn = console.warn;
    console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
    console.warn = () => {};
    try {
        await run();
    } finally {
        console.log = log;
        console.warn = warn;
    }
    return out;
}

// コードを、スタックトレースに出る名前(sourceURL)つきで動かす。import と export default だけを置き換える
function evaluate(code: string, file: string, modules: Record<string, unknown>): unknown {
    const body = code
        .replace(/^import \{([^}]+)\} from "([^"]+)";$/gm, (_, names: string, from: string) => `const {${names}} = __modules[${JSON.stringify(from)}];`)
        .replace(/^export default (\w+);$/m, "return $1;");
    return new Function("__modules", `${body}\n//# sourceURL=${file}`)(modules);
}

// new Function は前に行を足すので、スタックの行番号から引く数をこのエンジンで調べる
const LINE_OFFSET = (() => {
    try {
        new Function("throw new Error()\n//# sourceURL=probe.ts")();
    } catch (err) {
        const line = /probe\.ts:(\d+)/.exec(String((err as Error).stack))?.[1];
        if (line) return Number(line) - 1;
    }
    return 0;
})();

// --- CLI: logger() を入れたアプリを起動して、リクエストを送ったときの出力 ---

const CLI_APP = `import { createApp, logger } from "@senrijs/senri";

const app = createApp();
app.use(logger());

app.get("/", () => "Hello, Senri!");
app.get("/users/:id", ({ id }) => {
  if (id === "7") throw new Error("database connection lost");
  return { id };
});
app.post("/users", (_, c) => c.json({ ok: true }, 201));
app.delete("/users/:id", () => new Response(null, { status: 204 }));
app.get("/never-gonna-give-you-up", (_, c) => c.redirect("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
app.get("/files/*", async ({ "*": file }) => {
  if (file === "large.zip") await new Promise((r) => setTimeout(r, 620));
  return file;
});

export default app;
`;

const CLI_REQUESTS: [string, string][] = [
    ["GET", "/"],
    ["GET", "/users/42"],
    ["POST", "/users"],
    ["DELETE", "/users/42"],
    ["GET", "/never-gonna-give-you-up"],
    ["GET", "/never-gona-give-you-up"],
    ["GET", "/files/report.pdf"],
    ["GET", "/users/7"],
    ["GET", "/files/large.zip"],
];

async function cli(): Promise<HomeData["cli"]> {
    const app = evaluate(CLI_APP, "src/index.ts", { "@senrijs/senri": senri }) as senri.App;
    const url = `http://localhost:${DEFAULT_PORT}`;
    const banner = {} as HomeData["cli"]["banner"];
    for (const lang of LANGS) {
        const out = await capture(() => senri.showRoutes(app, url, { note: SERVE_MESSAGES[lang].default }));
        // 前後の空行は、ページの側で余白にする
        banner[lang] = parseAnsi(out.join("\n")).slice(1, -1);
    }

    // 同じコードに devtools() を入れたアプリ。404 の「もしかして」を、開発モードのレスポンスの本文から取る
    // devtools() は作るときに NODE_ENV を読むので、作る前から development にしておく(ブラウザで localhost を開いたときと同じ)
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "development";
    const devApp = evaluate(CLI_APP, "src/index.ts", {
        "@senrijs/senri": { ...senri, createApp: () => senri.createApp({ dev: devtools() }) },
    }) as senri.App;

    const logs: LogEntry[] = [];
    for (const [method, path] of CLI_REQUESTS) {
        let status = 0;
        const out = await capture(async () => {
            status = (await app.fetch(new Request(url + path, { method }))).status;
        });
        // new Function がずらした行番号を、ファイルの行番号に戻す
        const text = out.join("\n").replace(/src\/index\.ts:(\d+)/g, (_, n: string) => `src/index.ts:${Number(n) - LINE_OFFSET}`);
        const [line, ...rest] = parseAnsi(text);
        let note: LogEntry["note"] = null;
        if (status === 404) {
            const found = {} as Record<(typeof LANGS)[number], string>;
            for (const lang of LANGS) {
                let body = "";
                await capture(async () => {
                    body = await (await devApp.fetch(new Request(url + path, { method, headers: { "accept-language": lang } }))).text();
                });
                // 本文の 2 行目が「もしかして: GET /users/:id ?」
                const hint = body.split("\n")[1]?.replace(/\s*\?$/, "");
                if (hint) found[lang] = hint;
            }
            if (found.ja && found.en) note = found;
        }
        // エラーのときは、メッセージとスタックの先頭の行だけ(残りは Senri の中の行)
        logs.push({ line: line!, error: rest.slice(0, 2), note });
    }
    delete env.NODE_ENV;
    return { banner, logs };
}

// --- プレイグラウンド: 最初のコードを本物の Senri で動かした結果 ---

async function playground(): Promise<HomeData["playground"]> {
    // ブラウザ(Worker)では localhost の URL に開発モードが効く。ここでは NODE_ENV で同じにする
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "development";
    let lastError: unknown;
    // c.error を受け取るため、作ったアプリの先頭にミドルウェアを1つ足す
    const createApp = (options?: Parameters<typeof senri.createApp>[0]) => {
        const app = senri.createApp(options);
        app.use(async (c, next) => {
            const res = await next();
            lastError = c.error;
            return res;
        });
        return app;
    };
    const app = evaluate(PLAYGROUND_CODE, "app.ts", {
        "@senrijs/senri": { ...senri, createApp },
        "@senrijs/senri/dev": { devtools },
    }) as senri.App;

    const result = {} as HomeData["playground"];
    for (const lang of LANGS) {
        const list: Recording[] = [];
        for (const path of [...QUICK_PATHS, BOOM_PATH]) {
            lastError = undefined;
            const res = await app.fetch(new Request(`http://localhost:${DEFAULT_PORT}${path}`, { headers: { "accept-language": lang } }));
            const type = res.headers.get("content-type");
            const body = await res.text();
            const err = lastError instanceof Error ? lastError : null;
            const hint = err ? hintFor(err) : null;
            const line = err ? /app\.ts:(\d+)/.exec(String(err.stack))?.[1] : undefined;
            list.push({
                method: "GET",
                path,
                status: res.status,
                statusText: res.statusText || statusText(res.status),
                type,
                location: res.headers.get("location"),
                body: body === "" ? null : body,
                error: err
                    ? {
                          name: err.name,
                          message: err.message,
                          line: line ? Number(line) - LINE_OFFSET : null,
                          hint: hint ? hintText(hint, lang) : null,
                          hintCode: hint ? (hintCode(hint, lang) ?? null) : null,
                      }
                    : null,
            });
        }
        result[lang] = list;
    }
    delete env.NODE_ENV;
    return result;
}

function statusText(status: number): string {
    return { 200: "OK", 201: "Created", 204: "No Content", 302: "Found", 404: "Not Found", 500: "Internal Server Error" }[status] ?? "";
}

// --- 数字 ---

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await fetch(url, { headers: { "user-agent": "senri-website-build", ...headers }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
}

async function stats(): Promise<HomeData["stats"]> {
    // GitHub Actions では GITHUB_TOKEN を使う(なくても取れる。IP ごとに 1 時間 60 回まで)
    const token = process.env.GITHUB_TOKEN;
    const [stars, downloads] = await Promise.all([
        getJson("https://api.github.com/repos/Senrijs/Senri", token ? { authorization: `Bearer ${token}` } : {})
            .then((data) => (data as { stargazers_count?: unknown }).stargazers_count)
            .catch((err) => (console.warn(`GitHub のスター数を取れませんでした: ${err}`), null)),
        getJson("https://api.npmjs.org/downloads/point/last-week/@senrijs/senri")
            .then((data) => (data as { downloads?: unknown }).downloads)
            .catch((err) => (console.warn(`npm のダウンロード数を取れませんでした: ${err}`), null)),
    ]);
    const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { stars: count(stars), downloads: count(downloads) };
}

// --- 書き出す ---

const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
const data: HomeData = { version, port: DEFAULT_PORT, stats: await stats(), cli: await cli(), playground: await playground() };
writeFileSync(join(WEBSITE, "lib", "home", "generated.json"), `${JSON.stringify(data, null, 2)}\n`);
console.log(`lib/home/generated.json を書き出しました(v${version}、スター ${data.stats.stars ?? "-"}、ダウンロード ${data.stats.downloads ?? "-"})`);
