// HTTP ベンチマーク用のサーバー(Node.js)。node server-node.ts <senri|senri-0.2.9|hono|elysia|raw> <port>
// それぞれ、そのフレームワークが Node.js で勧めている形で動かす
// - senri: @senrijs/senri/node の serve(Request / Response を作らない近道が効く)
// - hono: @hono/node-server
// - elysia: @elysiajs/node のアダプター(Elysia の本命は Bun。Node.js ではアダプター経由になる)
// - raw: node:http だけ(上限の目安)
import { createServer } from "node:http";
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { serve as honoServe } from "@hono/node-server";
import { serve as senriServe } from "../adapters/node/index.ts";
import { serve as senri029Serve } from "senri-0.2.9/node";
import { honoApp, rawAnswer, ROUTES, senri029App, senriApp } from "./apps.ts";

const [name, portText] = process.argv.slice(2);
const port = Number(portText);
const hostname = "127.0.0.1";
const ready = () => console.log("ready");

switch (name) {
    case "senri": {
        senriServe(senriApp().app, { port, hostname }).once("listening", ready);
        break;
    }
    case "senri-0.2.9": {
        senri029Serve(senri029App().app, { port, hostname }).once("listening", ready);
        break;
    }
    case "hono": {
        honoServe({ fetch: honoApp().fetch, port, hostname }, ready);
        break;
    }
    case "elysia": {
        const app = new Elysia({ adapter: node() });
        for (const [method, path] of ROUTES) app.route(method, path, () => path);
        app.listen({ port, hostname }, ready);
        break;
    }
    case "raw": {
        createServer((req, res) => {
            const body = rawAnswer(req.method ?? "GET", `http://${hostname}${req.url ?? "/"}`);
            if (body === undefined) {
                res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
                res.end("Not Found");
                return;
            }
            res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
            res.end(body);
        }).listen(port, hostname, ready);
        break;
    }
    default:
        throw new Error("使い方: node server-node.ts <senri|senri-0.2.9|hono|elysia|raw> <port>");
}
