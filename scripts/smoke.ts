// examples を Bun / Deno / Node で順に起動して、実際に HTTP で叩いて確かめる
// 使い方: node scripts/smoke.ts [bun] [deno] [node]   (省略すると全部)
import { spawn } from "node:child_process";
import net from "node:net";

// 子プロセスには環境変数 PORT=3928 を渡す。serve() は「明示 → PORT → 3927」の順にポートを決めるので、
// - Bun / Node は PORT を読んで 3928 で待ち受ける
// - Deno は --allow-env なしで動かすので PORT を読めず、デフォルトの 3927 で待ち受ける(聞き返しもしない)
const ENV_PORT = 3928;
const DEFAULT_PORT = 3927;

const RUNTIMES: Record<string, { command: string[]; port: number; note: string }> = {
    bun: { command: ["bun", "run", "examples/bun/index.ts"], port: ENV_PORT, note: "環境変数 PORT" },
    deno: { command: ["deno", "run", "--allow-net", "examples/deno/index.ts"], port: DEFAULT_PORT, note: "デフォルト" },
    node: { command: ["node", "examples/node/index.ts"], port: ENV_PORT, note: "環境変数 PORT" },
};

type Check = {
    name: string;
    path: string;
    init?: RequestInit;
    status: number;
    body?: string;
    cookies?: string[];
    // 開発モードの HTML ページ。埋め込まれた JSON を確かめて、だめなら理由を返す
    page?: (data: any, runtime: string) => string | null;
    // JSON のレスポンス。中身を確かめて、だめなら理由を返す
    json?: (data: any) => string | null;
};

const browser = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };

const CHECKS: Check[] = [
    { name: "テキスト", path: "/hello", status: 200, body: "こんにちは!" },
    { name: "パスパラメーター", path: "/users/42", status: 200, body: "user 42" },
    { name: "POST", path: "/users", init: { method: "POST" }, status: 200 },
    { name: "POST のボディ", path: "/echo", init: { method: "POST", body: "こんにちは" }, status: 200, body: "body=こんにちは" },
    { name: "Set-Cookie 2つ", path: "/cookies", status: 200, cookies: ["a=1", "b=2"] },
    { name: "日本語パラメーター", path: "/users/山田", status: 200, body: "user 山田" },
    { name: "HEAD", path: "/hello", init: { method: "HEAD" }, status: 200, body: "" },
    {
        name: "QUERY",
        path: "/search",
        init: { method: "QUERY", headers: { "content-type": "application/json" }, body: `{"q":"senri"}` },
        status: 200,
        json: (d) => (d.query?.q === "senri" ? null : "ボディが届いていない"),
    },
    // 文字列のボディだと fetch が text/plain を付けてしまうので、バイト列で送る
    { name: "QUERY(Content-Type なし)", path: "/search", init: { method: "QUERY", body: new Uint8Array([120]) }, status: 415 },
    { name: "QUERY(ボディなし)", path: "/search", init: { method: "QUERY" }, status: 400 },
    {
        name: "c.ip",
        path: "/client-ip",
        status: 200,
        json: (d) => (/^(127\.0\.0\.1|::1)$/.test(d.ip ?? "") ? null : `ループバックでない: ${d.ip}`),
    },
    { name: "OPTIONS", path: "/hello", init: { method: "OPTIONS" }, status: 204 },
    { name: "認証", path: "/admin", status: 401 },
    { name: "認証(//admin)", path: "//admin", status: 401 },
    { name: "認証OK", path: "/admin", init: { headers: { authorization: "secret" } }, status: 200 },
    { name: "400", path: "/users/%E0%A4%A", status: 400 },
    { name: "404", path: "/nope", status: 404 },
    { name: "500", path: "/boom", status: 500 },
    {
        name: "エラーページ(HTML)",
        path: "/boom",
        init: { headers: browser },
        status: 500,
        page: (d, runtime) => {
            if (d.error?.message !== "わざと壊した") return "error.message が違う";
            if (!d.location?.file.endsWith("examples/shared/app.ts")) return "location が利用者のコードを指していない";
            // Deno は --allow-read なしで動かしているので、該当コードは読めない(それでもページは出る)
            if (runtime === "deno" ? d.code !== null : !d.code?.lines.some((l: any) => l.hit)) return "該当コードの扱いが違う";
            if (!d.layers?.some((l: any) => l.name === "handler" && l.failed)) return "通った順番に handler の失敗がない";
            return null;
        },
    },
    {
        name: "404ページ(HTML)",
        path: "/helo",
        init: { headers: browser },
        status: 404,
        page: (d) => {
            if (d.suggestion?.path !== "/hello" || !d.suggestion.link) return "もしかして が違う";
            if (!d.routes?.some((r: any) => r.path === "/users/:id" && !r.link)) return "ルート一覧が違う";
            return null;
        },
    },
    // ダッシュボード(開発モード・localhost から)。smoke は同じ PC から叩くので開ける
    {
        name: "ダッシュボード(HTML)",
        path: "/_senri",
        status: 200,
        page: (d) => (d.kind === "dashboard" && d.routes?.length > 0 ? null : "ダッシュボードのデータが違う"),
    },
    {
        name: "ダッシュボードの API(記録)",
        path: "/_senri/api/requests",
        status: 200,
        json: (list) =>
            !list.some((r: any) => r.path === "/hello")
                ? "/hello が記録されていない"
                : list.some((r: any) => r.path.startsWith("/_senri"))
                  ? "/_senri 自体が記録されている"
                  : null,
    },
];

function readPageData(body: string): unknown {
    const m = /<script type="application\/json" id="senri-data">([\s\S]*?)<\/script>/.exec(body);
    return m ? JSON.parse(m[1]!) : null;
}

// fetch では送れない、生の HTTP リクエストで確かめるもの
type RawCheck = { name: string; request: string; status: number };

const RAW_CHECKS: RawCheck[] = [
    // Host をつないで URL を作ると http://x/admin#/hello になり、パスが /admin に化ける
    {
        name: "不正な Host(パスのすり替え)",
        request: "GET /hello HTTP/1.1\r\nHost: x/admin#\r\nConnection: close\r\n\r\n",
        status: 400,
    },
    // DNS リバインディング: 接続元は localhost でも、Host が外のドメインならダッシュボードは開けない(普通の 404)
    {
        name: "ダッシュボード(Host の偽装)",
        request: "GET /_senri/api/requests HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n",
        status: 404,
    },
];

// ダッシュボードの SSE: つないだあとにリクエストすると、そのイベントが届くか
async function checkEvents(base: string): Promise<string | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    try {
        const res = await fetch(`${base}/_senri/api/events`, { signal: ac.signal });
        if (res.headers.get("content-type") !== "text/event-stream; charset=utf-8") return "text/event-stream ではない";
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let requested = false;
        while (!/event: request\ndata: .*"path":"\/ping"/.test(text)) {
            const chunk = await reader.read();
            if (chunk.done) return "途中で切れた";
            text += decoder.decode(chunk.value, { stream: true });
            // つながった(retry が届いた)ら、リクエストを1つ送る
            if (!requested && text.includes("retry:")) {
                requested = true;
                await (await fetch(`${base}/ping`)).text();
            }
        }
        return null;
    } catch {
        return "イベントが届かなかった";
    } finally {
        clearTimeout(timer);
        ac.abort();
    }
}

function sendRaw(port: number, request: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const sock = net.connect(port, "localhost", () => sock.write(request));
        let data = "";
        sock.on("data", (d) => (data += d));
        sock.on("end", () => resolve(Number(data.split(" ")[1])));
        sock.on("error", reject);
    });
}

async function waitForServer(base: string, exited: () => boolean): Promise<void> {
    for (let i = 0; i < 50; i++) {
        // 起動しないまま終わったなら、待っても無駄なのですぐに失敗にする
        if (exited()) throw new Error("サーバーが起動前に終了しました");
        try {
            await fetch(`${base}/hello`);
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error("サーバーが起動しませんでした");
}

async function smoke(runtime: string): Promise<boolean> {
    const { command, port, note } = RUNTIMES[runtime]!;
    const [cmd, ...args] = command;
    const base = `http://localhost:${port}`;
    const child = spawn(cmd!, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PORT: String(ENV_PORT) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    let ok = true;
    let exited = false;
    // 終了の待ち合わせは spawn の直後に用意する
    // あとで once("exit") を付けると、先に終わっていた(起動直後に落ちた)ときに永遠に待ってしまう
    // コマンドが見つからないときは exit ではなく error が来る
    const finished = new Promise<void>((resolve) => {
        child.once("exit", () => {
            exited = true;
            resolve();
        });
        child.once("error", (err) => {
            exited = true;
            ok = false;
            console.log(`  FAIL 起動できませんでした: ${err.message}`);
            resolve();
        });
    });
    try {
        await waitForServer(base, () => exited);
        // バナーに、待ち受けている URL と、ポートをどこから決めたかが出ているか
        const banner = stdout.includes(`${base}`) && stdout.includes(note);
        if (!banner) ok = false;
        console.log(`  ${banner ? "ok  " : "FAIL"} ポート: ${port}(${note})`);
        for (const check of CHECKS) {
            const res = await fetch(`${base}${check.path}`, check.init);
            const body = await res.text();
            const cookies = res.headers.getSetCookie();
            let reason: string | null = null;
            if (check.page) {
                const data = readPageData(body);
                reason = !res.headers.get("content-type")?.startsWith("text/html")
                    ? "HTML ではない"
                    : data === null
                      ? "データが埋め込まれていない"
                      : [...res.headers.keys()].some((k) => k.startsWith("x-senri"))
                        ? "内部ヘッダーが出ている"
                        : check.page(data, runtime);
            }
            if (check.json) {
                try {
                    reason = check.json(JSON.parse(body));
                } catch {
                    reason = "JSON ではない";
                }
            }
            const pass =
                res.status === check.status &&
                reason === null &&
                (check.body === undefined || body === check.body) &&
                (check.cookies === undefined || JSON.stringify(cookies) === JSON.stringify(check.cookies));
            if (!pass) ok = false;
            const shown = check.page || check.json ? (reason ?? (check.page ? "HTML ページ" : "JSON")) : JSON.stringify(body.slice(0, 60));
            console.log(`  ${pass ? "ok  " : "FAIL"} ${check.name}: ${res.status} ${shown}`);
        }
        const sse = await checkEvents(base);
        if (sse) ok = false;
        console.log(`  ${sse ? "FAIL" : "ok  "} ダッシュボードの SSE: ${sse ?? "イベントが届いた"}`);
        for (const check of RAW_CHECKS) {
            const status = await sendRaw(port, check.request);
            const pass = status === check.status;
            if (!pass) ok = false;
            console.log(`  ${pass ? "ok  " : "FAIL"} ${check.name}: ${status}`);
        }
    } catch (err) {
        ok = false;
        console.log(`  FAIL ${err instanceof Error ? err.message : String(err)}`);
        if (stderr) console.log(stderr);
    } finally {
        child.kill();
        await finished;
    }
    return ok;
}

const targets = process.argv.slice(2);
const runtimes = targets.length > 0 ? targets : Object.keys(RUNTIMES);

let allOk = true;
for (const runtime of runtimes) {
    if (!RUNTIMES[runtime]) throw new Error(`知らないランタイムです: ${runtime}`);
    console.log(`[${runtime}]`);
    if (!(await smoke(runtime))) allOk = false;
}
// process.exit() で強制終了すると、Windows では子プロセスの後片付け中に libuv が落ちることがあるので、
// 終了コードだけ決めて自然に終わらせる
process.exitCode = allOk ? 0 : 1;
