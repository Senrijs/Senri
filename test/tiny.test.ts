import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as full from "../src/index.ts";
import * as tiny from "../src/tiny.ts";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("@senrijs/senri/tiny", () => {
    test("@senrijs/senri と同じものを export する", () => {
        expect(Object.keys(tiny).sort()).toEqual(Object.keys(full).sort());
    });

    test("ルーティング・ミドルウェア・404 は同じように動く", async () => {
        const app = tiny.createApp();
        app.use(async (c, next) => {
            c.header("x-mw", "1");
            return next();
        });
        app.get("/users/:id", ({ id }) => ({ id }));

        const res = await app.fetch(req("/users/42"));
        expect(await res.json()).toEqual({ id: "42" });
        expect(res.headers.get("x-mw")).toBe("1");
        const missing = await app.fetch(req("/nope"));
        expect([missing.status, await missing.text()]).toEqual([404, "404 Not Found"]);
    });

    test("dev: true を渡すと、@senrijs/senri を使うよう案内するエラー", () => {
        expect(() => tiny.createApp({ dev: true })).toThrow("@senrijs/senri/tiny には開発モードがありません");
    });

    test("1つのファイルにまとめても、開発用のコードが入らない", async () => {
        const dir = await mkdtemp(join(tmpdir(), "senri-tiny-"));
        try {
            const entry = resolve(import.meta.dir, "../src/tiny.ts").replaceAll("\\", "/");
            await writeFile(
                join(dir, "main.ts"),
                `import { createApp } from "${entry}";\nconst app = createApp();\napp.get("/", () => "hi");\nexport default app;\n`,
            );
            const result = await Bun.build({ entrypoints: [join(dir, "main.ts")], target: "browser", minify: true });
            expect(result.success).toBe(true);
            const code = await result.outputs[0]!.text();
            // 開発用ページ(src/dev/page.generated.ts)とダッシュボードの目印
            expect(code).not.toContain("senri-data");
            expect(code).not.toContain("_senri/api");
            expect(code).not.toContain("node:fs");
            // いまは約 15KB。開発用のコードが入ると 150KB を超える
            expect(code.length).toBeLessThan(40_000);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
