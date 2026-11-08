// 純正のミドルウェアを Node で確かめるための、テスト用の部品
// Request を作らない道(serve(app))と、app.fetch を通す道(serve({ fetch }))の応答を比べる
import assert from "node:assert/strict";
import net, { type AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { App } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";

// ヘッダーの順番は HTTP の意味を変えないので、並べ替えてから比べる。日付はそろえる
export function normalize(text: string): string {
    const end = text.indexOf("\r\n\r\n");
    if (end === -1) return text;
    const [status, ...headers] = text.slice(0, end).split("\r\n");
    const sorted = [status, ...headers.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))].join("\r\n");
    return (sorted + text.slice(end)).replace(/^date: .*$/gim, "date: X");
}

export function raw(port: number, text: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => socket.write(text, "latin1"));
        let data = "";
        socket.on("data", (chunk) => (data += chunk.toString("latin1")));
        socket.on("close", () => resolve(normalize(data)));
        socket.on("error", reject);
    });
}

export const request = (method: string, path: string, headers: Record<string, string> = {}) =>
    `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join("")}\r\n`;

const servers: Server[] = [];

export async function listen(target: Parameters<typeof serve>[0]): Promise<number> {
    const server = serve(target, { port: 0, hostname: "127.0.0.1" });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return (server.address() as AddressInfo).port;
}

// 同じアプリを、2つの道で待ち受ける
export async function bothPaths(app: App<any>): Promise<{ lazy: number; viaFetch: number }> {
    return { lazy: await listen(app), viaFetch: await listen({ fetch: (req, info) => app.fetch(req, info) }) };
}

// 2つの道を比べるテストの時間の上限。接続を数百本張るので、test:node の既定(5秒)より長くする
export const COMPARE_TIMEOUT = 30_000;

// 同時に送る数。1件ずつ順番に送ると、Windows や test:node の並列実行で時間の上限を超える
const CONCURRENCY = 8;

// 同じリクエストを2つの道に送り、応答が同じかを1件ずつ確かめる(比べるのは1件ごと。送るのだけ同時に)
// signal(node:test の t.signal)が abort されたら(時間切れなど)送るのをやめる
// 裏で送り続けると、あとのテストが数える Request / Response の数を狂わせる
export async function compareBothPaths<T>(
    ports: { lazy: number; viaFetch: number },
    cases: readonly (readonly [label: string, send: (port: number) => Promise<T>])[],
    signal?: AbortSignal,
): Promise<void> {
    let next = 0;
    let failed = false;
    const worker = async () => {
        while (!failed && next < cases.length) {
            signal?.throwIfAborted();
            const [label, send] = cases[next++]!;
            try {
                const [lazy, viaFetch] = await Promise.all([send(ports.lazy), send(ports.viaFetch)]);
                assert.deepEqual(lazy, viaFetch, label);
            } catch (err) {
                failed = true;
                throw err;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));
}

// 生のリクエストの一覧を、compareBothPaths に渡す形にする
export const rawCases = (list: readonly (readonly [label: string, text: string])[], send = raw) =>
    list.map(([label, text]) => [label, (port: number) => send(port, text)] as const);

export function closeServers(): void {
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        server.close();
    }
}

// run の間に作られた Request / Response の数を数える
export async function counting(run: () => Promise<void>): Promise<{ Request: number; Response: number }> {
    const counts = { Request: 0, Response: 0 };
    const real = { Request: globalThis.Request, Response: globalThis.Response };
    for (const name of ["Request", "Response"] as const) {
        globalThis[name] = new Proxy(real[name] as any, {
            construct(target, args, newTarget) {
                counts[name]++;
                return Reflect.construct(target, args, newTarget);
            },
        });
    }
    try {
        await run();
    } finally {
        Object.assign(globalThis, real);
    }
    return counts;
}
