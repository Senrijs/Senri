import { app } from "../shared/app.ts";
import { WebSocketServer } from "ws";
import { serve } from "../../adapters/serve/index.ts";

// ポートは serve() が決める: serve(app, { port }) で明示 → 環境変数 PORT → 3927
// Node.js の WebSocket は ws パッケージに任せる(Bun と Deno は組み込みなので要らない)
// maxPayload: 1 つのメッセージの大きさの上限(ws の既定は 100 MiB)
serve(app, { webSocketServer: new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }) });
