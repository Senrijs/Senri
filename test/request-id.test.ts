import { describe, expect, test } from "bun:test";
import { createApp, HttpError, requestId, type RequestIdVariables } from "../src/index.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf, CONTEXT_MARKER } from "./bundle.ts";

const req = (path: string, headers?: Record<string, string>) => new Request(`http://localhost${path}`, { headers });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function appWith(options?: Parameters<typeof requestId>[0]) {
    const app = createApp<RequestIdVariables>();
    app.use(requestId(options));
    app.get("/", (_, c) => c.get("requestId") ?? "none");
    return app;
}

describe("requestId()", () => {
    test("UUID を作って、c.get とレスポンスのヘッダーで読める", async () => {
        const res = await appWith().fetch(req("/"));
        const id = res.headers.get("x-request-id");

        expect(id).toMatch(UUID);
        expect(await res.text()).toBe(id!);
    });

    test("リクエストごとに違う ID になる", async () => {
        const app = appWith();
        const a = await app.fetch(req("/"));
        const b = await app.fetch(req("/"));

        expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
    });

    test("既定では、受け取った ID を使わない", async () => {
        const res = await appWith().fetch(req("/", { "x-request-id": "from-client" }));

        expect(res.headers.get("x-request-id")).toMatch(UUID);
    });

    test("trustIncoming なら、受け取った ID を使う", async () => {
        const app = appWith({ trustIncoming: true });
        for (const id of ["abc-123", "a.b_c=d+e/f", "A".repeat(128)]) {
            const res = await app.fetch(req("/", { "x-request-id": id }));

            expect(res.headers.get("x-request-id")).toBe(id);
            expect(await res.text()).toBe(id);
        }
    });

    test("trustIncoming でも、安全でない値は捨てて作り直す", async () => {
        const app = appWith({ trustIncoming: true });
        const unsafe = ["", "a b", "a,b", 'a"b', "a\tb", "<script>", "{a}", "日本語", "A".repeat(129), "a%0d%0ab"];
        for (const id of unsafe) {
            // Headers は latin1 までしか受け付けないので、UTF-8 のバイト列のまま渡す
            const res = await app.fetch(req("/", { "x-request-id": Buffer.from(id).toString("latin1") }));

            expect(res.headers.get("x-request-id")).toMatch(UUID);
        }
    });

    test("trustIncoming でも、ヘッダーがなければ作る", async () => {
        const res = await appWith({ trustIncoming: true }).fetch(req("/"));

        expect(res.headers.get("x-request-id")).toMatch(UUID);
    });

    test("headerName を変えられる。大文字小文字は問わない", async () => {
        const res = await appWith({ trustIncoming: true, headerName: "X-Trace-Id" }).fetch(req("/", { "x-trace-id": "t1", "x-request-id": "r1" }));

        expect(res.headers.get("x-trace-id")).toBe("t1");
        expect(res.headers.get("x-request-id")).toBeNull();
    });

    test("headerName が不正なら、作るときに投げる", () => {
        expect(() => requestId({ headerName: "x bad" })).toThrow(/headerName/);
        expect(() => requestId({ headerName: "" })).toThrow(/headerName/);

        const err = (() => {
            try {
                requestId({ headerName: "x bad" });
            } catch (e) {
                return e;
            }
        })();
        expect(explainText(err, "ja")).toContain("headerName");
    });

    test("generator で作り方を変えられる", async () => {
        let seen = "";
        const app = appWith({
            generator: (c) => {
                seen = c.path;
                return "fixed";
            },
        });
        const res = await app.fetch(req("/"));

        expect(seen).toBe("/");
        expect(res.headers.get("x-request-id")).toBe("fixed");
    });

    test("エラーのレスポンスにも付く", async () => {
        const app = createApp();
        app.use(requestId());
        app.get("/http", () => {
            throw new HttpError(403, "no");
        });
        app.get("/boom", () => {
            throw new Error("boom");
        });

        for (const [path, status] of [["/http", 403], ["/boom", 500], ["/none", 404]] as const) {
            const res = await app.fetch(req(path));

            expect(res.status).toBe(status);
            expect(res.headers.get("x-request-id")).toMatch(UUID);
        }
    });

    test("c.get の型は string | undefined", () => {
        const app = createApp<RequestIdVariables>();
        app.get("/", (_, c) => {
            const id: string | undefined = c.get("requestId");
            return id ?? "";
        });
    });

    test("名前と印", () => {
        const middleware = requestId();

        expect(middleware.name).toBe("requestId");
        expect(isPlainSafe(middleware)).toBe(true);
    });
});

describe("requestId() とバンドル", () => {
    test("requestId だけなら、Context が入らない", async () => {
        expect(await bundleOf("requestId")).not.toContain(CONTEXT_MARKER);
    });

    test("使わなければ、本体に入らない", async () => {
        const code = await bundleOf("createApp");

        expect(code).toContain(CONTEXT_MARKER);
        expect(code.toLowerCase()).not.toContain("x-request-id");
    });
});
