import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { DEFAULT_PORT, resolvePort, serve } from "../adapters/serve/index.ts";

const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

describe("resolvePort: 明示した port → 環境変数 PORT → デフォルト", () => {
    test("デフォルトは 3927", () => {
        expect(DEFAULT_PORT).toBe(3927);
        expect(resolvePort(undefined, envOf({}))).toEqual({ port: 3927, source: "default" });
    });

    test("環境変数 PORT があればそれを使う", () => {
        expect(resolvePort(undefined, envOf({ PORT: "8080" }))).toEqual({ port: 8080, source: "env" });
    });

    test("明示した port は PORT より優先", () => {
        expect(resolvePort(4000, envOf({ PORT: "8080" }))).toEqual({ port: 4000, source: "option" });
    });

    test("port: 0(空いているポートを自動で選ぶ)も明示として扱う", () => {
        expect(resolvePort(0, envOf({ PORT: "8080" }))).toEqual({ port: 0, source: "option" });
    });

    test("空の PORT は、ないものとして扱う", () => {
        expect(resolvePort(undefined, envOf({ PORT: "  " }))).toEqual({ port: 3927, source: "default" });
    });

    test("PORT が正しいポート番号でなければエラー(黙って別のポートで待ち受けない)", () => {
        for (const value of ["abc", "70000", "-1", "3.5", "80a"]) {
            expect(() => resolvePort(undefined, envOf({ PORT: value }))).toThrow(`環境変数 PORT`);
        }
    });

    test("明示した port が正しくなければエラー", () => {
        expect(() => resolvePort(70000, envOf({}))).toThrow("port");
    });
});

describe("resolvePort: Deno の権限", () => {
    afterEach(() => {
        delete (globalThis as { Deno?: unknown }).Deno;
    });

    function fakeDeno(envGranted: boolean) {
        (globalThis as { Deno?: unknown }).Deno = {
            permissions: { querySync: () => ({ state: envGranted ? "granted" : "prompt" }) },
            env: { get: (name: string) => (name === "PORT" ? "8080" : undefined) },
            cwd: () => "/app",
        };
    }

    test("--allow-env があれば PORT を読む", () => {
        fakeDeno(true);

        expect(resolvePort(undefined)).toEqual({ port: 8080, source: "env" });
    });

    test("--allow-env がなければ、聞き返さずにデフォルトを使う", () => {
        fakeDeno(false);

        expect(resolvePort(undefined)).toEqual({ port: 3927, source: "default" });
    });
});

describe("serve(Bun)", () => {
    const app = createApp();
    app.get("/hello", () => "hi");

    test("port: 0 でも、実際に待ち受けたポートが url と port に入る", async () => {
        const server = await serve(app, { port: 0, banner: false });
        try {
            expect(server.port).toBeGreaterThan(0);
            expect(server.url).toBe(`http://localhost:${server.port}`);
            expect(await (await fetch(`${server.url}/hello`)).text()).toBe("hi");
        } finally {
            await server.stop();
        }
    });

    test("環境変数 PORT で起動できる", async () => {
        const before = process.env.PORT;
        process.env.PORT = "0";
        try {
            const server = await serve(app, { banner: false });
            expect(server.port).toBeGreaterThan(0);
            await server.stop();
        } finally {
            if (before === undefined) delete process.env.PORT;
            else process.env.PORT = before;
        }
    });

    test("バナーに、実際の URL と、ポートをどこから決めたかが出る", async () => {
        const log = spyOn(console, "log").mockImplementation(() => {});
        try {
            const server = await serve(app, { port: 0 });
            await server.stop();
            const text = log.mock.calls.map((args) => String(args[0])).join("\n");

            expect(text).toContain(`http://localhost:${server.port}`);
            expect(text).toContain("port オプション");
        } finally {
            log.mockRestore();
        }
    });
});
