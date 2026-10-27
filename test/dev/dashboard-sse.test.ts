import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/index.ts";
import { dashboardOf, devtools } from "../../src/dev/index.ts";
import { RequestLog } from "../../src/dev/dashboard/log.ts";
import { eventStream } from "../../src/dev/dashboard/sse.ts";
import type { DashboardRecord } from "../../src/dev/dashboard/record.ts";

const record = (id: string, path = "/hello"): DashboardRecord => ({
    id,
    time: 0,
    method: "GET",
    path,
    query: "",
    route: path,
    params: {},
    status: 200,
    durationMs: 1,
    layers: [],
    requestHeaders: [],
    responseHeaders: [],
    error: null,
});

// ストリームを読み進めて、条件に合うテキストが届くまで待つ(届かなければタイムアウトで失敗)
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, done: (text: string) => boolean, ms = 2000) {
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + ms;
    while (!done(text)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`届かなかった。ここまで: ${JSON.stringify(text)}`);
        const chunk = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`時間切れ: ${JSON.stringify(text)}`)), remaining)),
        ]);
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
    }
    return text;
}

describe("eventStream: SSE", () => {
    test("text/event-stream で、最初に再接続の間隔を送る", async () => {
        const log = new RequestLog<DashboardRecord>();
        const ac = new AbortController();

        const res = eventStream(log, new Request("http://l/", { signal: ac.signal }));
        const text = await readUntil(res.body!.getReader(), (t) => t.includes("\n\n"));

        expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
        expect(text).toStartWith("retry: 2000\n\n");
        ac.abort();
    });

    test("記録が増えると request イベント(要約の JSON)、クリアすると clear イベントが届く", async () => {
        const log = new RequestLog<DashboardRecord>();
        const ac = new AbortController();
        const reader = eventStream(log, new Request("http://l/", { signal: ac.signal })).body!.getReader();
        await readUntil(reader, (t) => t.includes("retry"));

        log.add(record("7", "/users/7"));
        const added = await readUntil(reader, (t) => t.includes("event: request"));
        log.clear();
        const cleared = await readUntil(reader, (t) => t.includes("event: clear"));

        const data = JSON.parse(/data: (.*)\n/.exec(added)![1]!);
        expect(data).toEqual({ id: "7", time: 0, method: "GET", path: "/users/7", status: 200, durationMs: 1, hasError: false });
        expect(cleared).toContain("event: clear\ndata: {}\n\n");
        ac.abort();
    });

    test("接続が切れたら(req.signal の abort)購読をやめ、ストリームを閉じる", async () => {
        const log = new RequestLog<DashboardRecord>();
        const ac = new AbortController();
        const reader = eventStream(log, new Request("http://l/", { signal: ac.signal })).body!.getReader();
        await readUntil(reader, (t) => t.includes("retry"));
        expect(log.listenerCount).toBe(1);

        ac.abort();

        expect(log.listenerCount).toBe(0);
        expect((await reader.read()).done).toBe(true);
    });

    test("クライアントが読むのをやめても(cancel)購読をやめる", async () => {
        const log = new RequestLog<DashboardRecord>();
        const reader = eventStream(log, new Request("http://l/")).body!.getReader();
        await readUntil(reader, (t) => t.includes("retry"));

        await reader.cancel();

        expect(log.listenerCount).toBe(0);
    });

    test("読まれないまま送り待ちがたまったら、閉じて購読をやめる(メモリに積み上がらないように)", async () => {
        const log = new RequestLog<DashboardRecord>();
        // 読まない(ブラウザ側が詰まっている)状態で、上限 3 件
        const res = eventStream(log, new Request("http://l/"), { maxQueued: 3 });

        for (let i = 1; i <= 10; i++) log.add(record(String(i)));

        expect(log.listenerCount).toBe(0);
        // たまっていた分は読めて、そのあと終わる(EventSource はつなぎ直して一覧を取り直す)
        const text = await readUntil(res.body!.getReader(), () => false).catch((e: Error) => e.message);
        expect(text).not.toContain('"id":"10"');
    });

    test("何もなくても一定間隔でコメント(: ping)を送る(Bun などが無通信の接続を切らないように)", async () => {
        const log = new RequestLog<DashboardRecord>();
        const ac = new AbortController();
        const reader = eventStream(log, new Request("http://l/", { signal: ac.signal }), { heartbeatMs: 20 }).body!.getReader();

        const text = await readUntil(reader, (t) => t.includes(": ping"));

        expect(text).toContain(": ping\n\n");
        ac.abort();
    });
});

describe("/_senri/api/events", () => {
    const local = { requestIP: () => ({ address: "127.0.0.1" }) };

    test("アプリにリクエストが来ると、ダッシュボードに届く", async () => {
        const app = createApp({ dev: devtools() });
        app.get("/hello", () => "hi");
        const ac = new AbortController();

        const res = await app.fetch(
            new Request("http://localhost:3927/_senri/api/events", { signal: ac.signal, headers: { host: "localhost:3927" } }),
            local,
        );
        const reader = res.body!.getReader();
        await readUntil(reader, (t) => t.includes("retry"));
        await app.fetch(new Request("http://localhost:3927/hello"), local);
        const text = await readUntil(reader, (t) => t.includes("event: request"));

        expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
        expect(text).toContain('"path":"/hello"');
        ac.abort();
        expect((await dashboardOf(app))!.log.listenerCount).toBe(0);
    });
});
