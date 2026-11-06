import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bodyLimit, Context, cors, createApp, health, logger, secureHeaders } from "../src/index.ts";
import { headerOf, hasNoBody, isPlainSafe, methodOf, PlainResponse, urlOf } from "../src/plain.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("純正のミドルウェアの印", () => {
    test("純正のものには付いている。名前も変わらない", () => {
        const list: [string, object & { name: string }][] = [
            ["logger", logger()],
            ["cors", cors()],
            ["secureHeaders", secureHeaders()],
            ["bodyLimit", bodyLimit({ maxSize: 1 })],
            ["health", health()],
        ];
        for (const [name, middleware] of list) {
            expect(isPlainSafe(middleware)).toBe(true);
            expect(middleware.name).toBe(name);
        }
    });

    test("利用者が書いたものには付いていない", () => {
        expect(isPlainSafe(async () => {})).toBe(false);
    });

    test("ダッシュボードなどに出る名前も今までどおり", () => {
        const app = createApp();
        app.use(logger());
        app.use(cors());

        expect(app.middlewareList().map((m) => m.name)).toEqual(["logger", "cors"]);
    });
});

describe("Node 以外の Context では、c.req を読む", () => {
    const c = () => new Context(req("/a?b=1", { method: "POST", body: "x", headers: { "x-a": "1" } }));

    test("methodOf / urlOf / headerOf", () => {
        expect(methodOf(c())).toBe("POST");
        expect(urlOf(c())).toBe("http://localhost/a?b=1");
        expect(headerOf(c(), "x-a")).toBe("1");
        expect(headerOf(c(), "x-none")).toBeNull();
    });

    test("hasNoBody は、分からないので false", () => {
        expect(hasNoBody(c())).toBe(false);
        expect(hasNoBody(new Context(req("/")))).toBe(false);
    });
});

describe("PlainResponse", () => {
    test("headers は、使われるまで作らない", () => {
        const plain = new PlainResponse(200, "text/plain", "x", undefined);

        expect(plain.added).toBeUndefined();
        plain.headers.set("x-a", "1");
        expect(plain.added?.get("x-a")).toBe("1");
        expect(plain.headers.get("content-type")).toBe("text/plain");
    });
});

// 純正のミドルウェアだけを使うバンドルに、Context が付いてこないこと
describe("バンドル", () => {
    const SRC = resolve(import.meta.dir, "../src").replaceAll("\\", "/");

    async function bundle(code: string): Promise<string> {
        const dir = mkdtempSync(join(tmpdir(), "senri-plain-"));
        try {
            writeFileSync(join(dir, "main.ts"), code);
            const result = await Bun.build({ entrypoints: [join(dir, "main.ts")], target: "browser", minify: true, outdir: join(dir, "out") });
            if (!result.success) throw new Error(String(result.logs));
            return readFileSync(join(dir, "out", "main.js"), "utf8");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    test.each([
        ["cors", "cors"],
        ["logger", "logger"],
        ["secureHeaders", "secureHeaders"],
        ["bodyLimit", "bodyLimit"],
        ["health", "health"],
    ])("%s だけなら、Context が入らない", async (_, name) => {
        const code = await bundle(`export { ${name} } from "${SRC}/index.ts";\n`);

        // Context にしかないエラーのコード
        expect(code).not.toContain("no_execution_ctx");
    });

    test("比べているコードは、Context があれば入る", async () => {
        const code = await bundle(`export { createApp } from "${SRC}/index.ts";\n`);

        expect(code).toContain("no_execution_ctx");
    });
});
