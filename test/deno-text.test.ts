// Deno では、c.header() がなく 200 の文字列を init なしの Response で作る(Content-Type は Deno が付ける)
// それ以外は、どのランタイムでも text/plain; charset=utf-8 のまま
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/index.ts";

test("Deno 以外では、ヘッダーのない 200 の文字列も text/plain; charset=utf-8", async () => {
    const app = createApp();
    app.get("/", () => "hi");
    app.get("/text", (_, c) => c.text("t"));
    for (const path of ["/", "/text"]) {
        const res = await app.fetch(new Request(`http://localhost${path}`));
        expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    }
});

// Deno を子プロセスで動かす。Deno のない環境では飛ばす
const DENO = Bun.which("deno");
test.skipIf(!DENO)(
    "Deno: ヘッダーのない 200 の文字列だけ、Deno の既定の Content-Type になる",
    async () => {
        const dir = mkdtempSync(join(tmpdir(), "senri-deno-text-"));
        const file = join(dir, "main.ts");
        const src = JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/index.ts")).href);
        await Bun.write(
            file,
            `import { createApp } from ${src};
const app = createApp();
app.get("/", () => "hi");
app.get("/text", (_, c) => c.text("t"));
app.get("/status", (_, c) => c.text("s", 201));
app.get("/header", (_, c) => {
    c.header("x-mark", "1");
    return "h";
});
app.get("/type", (_, c) => {
    c.header("content-type", "text/html");
    return "<p/>";
});
app.get("/json", () => ({ a: 1 }));
const out: Record<string, unknown> = {};
for (const path of ["/", "/text", "/status", "/header", "/type", "/json", "/missing"]) {
    const res = await app.fetch(new Request("http://localhost" + path));
    out[path] = [res.status, res.headers.get("content-type"), res.headers.get("x-mark"), await res.text()];
}
console.log(JSON.stringify(out));
`,
        );
        const proc = Bun.spawn([DENO!, "run", "--allow-read", file], { stdout: "pipe", stderr: "pipe" });
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
        expect(await proc.exited).toBe(0);
        expect(err).toBe("");
        expect(JSON.parse(out)).toEqual({
            "/": [200, "text/plain;charset=UTF-8", null, "hi"],
            "/text": [200, "text/plain;charset=UTF-8", null, "t"],
            "/status": [201, "text/plain; charset=utf-8", null, "s"],
            "/header": [200, "text/plain; charset=utf-8", "1", "h"],
            "/type": [200, "text/html", null, "<p/>"],
            "/json": [200, "application/json", null, '{"a":1}'],
            "/missing": [404, "text/plain; charset=utf-8", null, "404 Not Found"],
        });
    },
    60_000,
);
