// Node 本体で動かすアダプターのテスト(bun run test:node)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";

const app = createApp();
app.get("/hello", () => "hi");

let server: Server;
let base: string;

before(async () => {
    server = serve(app, { port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => {
    server.close();
});

describe("Node アダプター", () => {
    test("GET でテキストが返る", async () => {
        const res = await fetch(`${base}/hello`);

        assert.equal(res.status, 200);
        assert.equal(await res.text(), "hi");
    });
});
