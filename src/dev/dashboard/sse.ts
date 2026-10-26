// ダッシュボードのリアルタイム更新(SSE: Server-Sent Events)
//
// SSE は、1回の HTTP レスポンスを閉じずに開いたままにして、サーバーから文字を書き足していく仕組み。
// ブラウザの EventSource が、次の形を1つのイベントとして受け取る:
//
//   event: request          ← イベントの名前
//   data: {"id":"12",...}   ← 中身(1行の JSON)
//   (空行)                  ← ここで1つのイベントが終わる
//
// ":" で始まる行はコメントで、イベントにはならない(接続を保つための ping に使う)
// "retry: 2000" は、切れたときに何ミリ秒後につなぎ直すかをブラウザに伝える
//
// レスポンスのボディを Web 標準の ReadableStream にすれば、Bun / Deno / Node(アダプター)のどれでも、
// enqueue した分から順にクライアントへ送られる
import type { RequestLog } from "./log.ts";
import type { DashboardRecord } from "./record.ts";
import { summarize } from "./routes.ts";

export type EventStreamOptions = {
    // 何も送るものがなくても、この間隔で ping を送る。
    // Bun は無通信の接続を約10秒で切るので、それより短くする
    heartbeatMs?: number;
    // ブラウザに送れないまま、たまってよいイベントの数。これを超えたら閉じる
    // (読む側が詰まっていると、記録が増えるたびにメモリに積み上がってしまうので。
    //  閉じても EventSource が自動でつなぎ直し、画面は一覧を取り直す)
    maxQueued?: number;
};

export function eventStream(log: RequestLog<DashboardRecord>, req: Request, options: EventStreamOptions = {}): Response {
    const encoder = new TextEncoder();
    const heartbeatMs = options.heartbeatMs ?? 5000;
    const maxQueued = options.maxQueued ?? 32;
    let closed = false;
    let cleanup = () => {};

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (text: string) => {
                if (closed) return;
                // desiredSize は「あと何件ためられるか」。0 以下なら、読まれないまま上限までたまっている
                if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                    cleanup();
                    return;
                }
                try {
                    controller.enqueue(encoder.encode(text));
                } catch {
                    // もう閉じていて書けない(クライアントが切れた)
                    cleanup();
                }
            };

            const unsubscribe = log.subscribe((event) => {
                if (event.type === "request") {
                    // JSON.stringify は改行をエスケープするので、data は必ず1行になる
                    send(`event: request\ndata: ${JSON.stringify(summarize(event.item))}\n\n`);
                } else {
                    send("event: clear\ndata: {}\n\n");
                }
            });
            const timer = setInterval(() => send(": ping\n\n"), heartbeatMs);
            // テストなどで、この ping のせいでプロセスが終われなくならないように(Node / Bun)
            (timer as { unref?: () => void }).unref?.();

            const onAbort = () => cleanup();
            // 後片付けは、接続が切れたとき(req.signal)と、読む側がやめたとき(cancel)のどちらからでも1回だけ
            cleanup = () => {
                if (closed) return;
                closed = true;
                unsubscribe();
                clearInterval(timer);
                req.signal.removeEventListener("abort", onAbort);
                try {
                    controller.close();
                } catch {
                    // すでに閉じている
                }
            };
            if (req.signal.aborted) {
                cleanup();
                return;
            }
            req.signal.addEventListener("abort", onAbort, { once: true });

            send(`retry: 2000\n\n`);
        },
        cancel() {
            cleanup();
        },
    }, new CountQueuingStrategy({ highWaterMark: maxQueued }));

    return new Response(stream, {
        headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            // 間にプロキシ(nginx など)があっても、ためずにすぐ流してもらう
            "x-accel-buffering": "no",
        },
    });
}
