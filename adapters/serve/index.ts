import { showRoutes } from "../../src/index.ts";

type App = {
    fetch: (req: Request) => Response | Promise<Response>;
    routeList(): { method: string; path: string }[];
};

type ServeOptions = {
    port?: number;
    hostname?: string;   // 省略するとランタイムのデフォルト(外からも繋がる)
    banner?: boolean;    // false で起動時のルート一覧を出さない
};

export type Server = {
    url: string;
    stop(): Promise<void>;
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
    ): { shutdown(): Promise<void> };
};

export async function serve(app: App, options: ServeOptions = {}): Promise<Server> {
    const port = options.port ?? 3000;
    const hostname = options.hostname;
    const url = `http://${hostname ?? "localhost"}:${port}`;
    const g = globalThis as { Bun?: BunLike; Deno?: DenoLike };

    let server: Server;

    if (g.Bun) {
        const s = g.Bun.serve({ port, hostname, fetch: app.fetch });
        server = { url, stop: async () => s.stop() };
    } else if (g.Deno) {
        // onListen を空にして、Deno が勝手に出す "Listening on ..." を消す(バナーと二重になるので)
        const s = g.Deno.serve({ port, hostname, onListen() {} }, app.fetch);
        server = { url, stop: () => s.shutdown() };
    } else {
        // Node のときだけ node:http を読み込む
        const node = await import("../node/index.ts");
        const s = node.serve(app, { port });
        server = {
            url,
            stop: () => new Promise((resolve) => s.close(() => resolve())),
        };
    }

    if (options.banner ?? true) {
        showRoutes(app, server.url);
    }
    return server;
}