import { showRoutes } from "../../src/index.ts";
import * as runtime from "../../src/runtime.ts";

type App = {
    fetch: (req: Request) => Response | Promise<Response>;
    routeList(): { method: string; path: string }[];
};

type ServeOptions = {
    // 省略すると、環境変数 PORT → DEFAULT_PORT の順に使う。0 なら空いているポートを自動で選ぶ
    port?: number;
    hostname?: string;   // 省略するとランタイムのデフォルト(外からも繋がる)
    banner?: boolean;    // false で起動時のルート一覧を出さない
};

export type Server = {
    // 実際に待ち受けているポート(port: 0 のときも、選ばれた番号が入る)
    port: number;
    url: string;
    stop(): Promise<void>;
};

// よく使われる 3000 や 8080 とぶつかりにくい番号にしている
export const DEFAULT_PORT = 3927;

// - option: serve(app, { port }) で明示した
// - env: 環境変数 PORT(デプロイ先のサービスが決めることが多い)
// - default: どちらもなかった
export type PortSource = "option" | "env" | "default";

function isPort(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n <= 65535;
}

// 使うポートを決める: 明示した port → 環境変数 PORT → DEFAULT_PORT
// 環境変数は runtime.env で読むので、Deno で --allow-env がなければ聞き返さずにデフォルトになる
export function resolvePort(
    explicit: number | undefined,
    env: (name: string) => string | undefined = runtime.env,
): { port: number; source: PortSource } {
    if (explicit !== undefined) {
        if (!isPort(explicit)) throw new RangeError(`port が正しいポート番号(0〜65535)ではありません: ${explicit}`);
        return { port: explicit, source: "option" };
    }
    const raw = env("PORT")?.trim();
    if (raw) {
        // 黙ってデフォルトで待ち受けると、デプロイ先で「つながらない」原因が分かりにくいので、エラーにする
        const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!isPort(port)) throw new RangeError(`環境変数 PORT が正しいポート番号(0〜65535)ではありません: ${raw}`);
        return { port, source: "env" };
    }
    return { port: DEFAULT_PORT, source: "default" };
}

const SOURCE_NOTE: Record<PortSource, string> = {
    option: "port オプション",
    env: "環境変数 PORT",
    default: "デフォルト。環境変数 PORT で変えられます",
};

// Bun と Deno の、ここで使う部分だけの型
// (このフォルダは Node の型しか入れてないので、自分で書いておく)
type BunLike = {
    serve(options: {
        port: number;
        hostname?: string;
        fetch: App["fetch"];
    }): { port: number; stop(): void };
};
type DenoLike = {
    serve(
        options: { port: number; hostname?: string; onListen?: () => void },
        handler: App["fetch"],
    ): { addr: { port: number }; shutdown(): Promise<void> };
};

export async function serve(app: App, options: ServeOptions = {}): Promise<Server> {
    const { port, source } = resolvePort(options.port);
    const hostname = options.hostname;
    const g = globalThis as { Bun?: BunLike; Deno?: DenoLike };

    // 実際に待ち受けたポート(port: 0 なら、ランタイムが選んだ番号)と、止め方
    let actualPort: number;
    let stop: () => Promise<void>;

    if (g.Bun) {
        const s = g.Bun.serve({ port, hostname, fetch: app.fetch });
        actualPort = s.port;
        stop = async () => s.stop();
    } else if (g.Deno) {
        // onListen を空にして、Deno が勝手に出す "Listening on ..." を消す(バナーと二重になるので)
        const s = g.Deno.serve({ port, hostname, onListen() {} }, app.fetch);
        actualPort = s.addr.port;
        stop = () => s.shutdown();
    } else {
        // Node のときだけ node:http を読み込む
        const node = await import("../node/index.ts");
        const s = node.serve(app, { port });
        // Node は待ち受けが非同期。使用中のポートなどは error イベントで来るので、ここで reject にする
        // (受け取らないとプロセスごと落ちる)
        await new Promise<void>((resolve, reject) => {
            s.once("listening", resolve);
            s.once("error", reject);
        });
        const address = s.address();
        actualPort = typeof address === "object" && address ? address.port : port;
        stop = () => new Promise((resolve) => s.close(() => resolve()));
    }

    const url = `http://${hostname ?? "localhost"}:${actualPort}`;
    if (options.banner ?? true) {
        showRoutes(app, url, { note: SOURCE_NOTE[source] });
    }
    return { port: actualPort, url, stop };
}
