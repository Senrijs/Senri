// serve()(@senrijs/senri/node)がターミナルに出す案内。en を元にして、ja は同じキーを必ず持つ
import type { Lang } from "../../src/lang.ts";

const en = {
    maxPayload:
        "The WebSocketServer passed to serve() has the default maxPayload of ws (100 MiB): one message can use that much memory. Set it, as in new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }).",
};

const ja: Record<keyof typeof en, string> = {
    maxPayload:
        "serve() に渡した WebSocketServer の maxPayload が、ws の既定(100 MiB)のままです。1 つのメッセージでそれだけメモリを使えてしまいます。new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }) のように付けてください。",
};

export const NODE_MESSAGES: Record<Lang, Record<keyof typeof en, string>> = { en, ja };
