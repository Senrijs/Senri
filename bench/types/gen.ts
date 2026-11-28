// 型チェックの時間を測るための、ルートが多いアプリを作る(run.ts から使う。単体でも動く)
//
//   bun bench/types/gen.ts <出力のフォルダー> <書き方> <ルート数> [Senri の src/index.ts への相対パス]
//
// 書き方:
// - plain:  createApp<Vars>() と、つながない app.use()。全体の変数は c.get("user")?.name のように ?. で読む(0.4 までの書き方)
// - chain:  createApp<Vars>().use(...).use(...) とつなげる(#160)。全体の変数は ?. なしで読む。パス付きの use は今までどおり
// - scoped: パス付きの use もつなげて、パスの下の変数も ?. なしで読む(#161 の案 B。今の main では型エラーになる)
//
// アプリの形: 全体の use 5 つ、パス付きの use 5 つ。ルートは 7 種類の前置きに順に置き、3 つに 1 つはルートの use も付ける
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Variant = "plain" | "chain" | "scoped";
export const VARIANTS: readonly Variant[] = ["plain", "chain", "scoped"];

export function generate(outDir: string, variant: Variant, routes: number, src: string): void {
    mkdirSync(outDir, { recursive: true });
    const head = `
import { createApp, type Middleware } from "${src}";
type User = { id: string; name: string };
type Org = { id: string };
const requireUser: Middleware<{}, { vars: { user: User }; errors: 401 }> = async (c, next) => { c.set("user", { id: "1", name: "a" }); return next(); };
const rid: Middleware<{}, { vars: { rid: string } }> = async (c, next) => { c.set("rid", "x"); return next(); };
const lang: Middleware<{}, { vars: { lang: string } }> = async (c, next) => { c.set("lang", "ja"); return next(); };
const tenant: Middleware<{}, { vars: { tenant: string } }> = async (c, next) => { c.set("tenant", "t"); return next(); };
const trace: Middleware<{}, { vars: { trace: string } }> = async (c, next) => { c.set("trace", "t"); return next(); };
const requireAdmin: Middleware<{}, { vars: { admin: true }; errors: 403 }> = async (c, next) => { c.set("admin", true); return next(); };
const loadOrg: Middleware<{}, { vars: { org: Org } }> = async (c, next) => { c.set("org", { id: "o" }); return next(); };
const audit: Middleware<{}, { vars: { audit: number } }> = async (c, next) => { c.set("audit", 1); return next(); };
const beta: Middleware<{}, { vars: { beta: boolean } }> = async (c, next) => { c.set("beta", true); return next(); };
const quota: Middleware<{}, { vars: { quota: number } }> = async (c, next) => { c.set("quota", 1); return next(); };
type Vars = { user: User; rid: string; lang: string; tenant: string; trace: string; admin: true; org: Org; audit: number; beta: boolean; quota: number };
`;
    const scoped = `.use("/admin", requireAdmin).use("/orgs/:orgId", loadOrg).use("/admin/audit", audit).use("/beta", beta).use("/api/v1", quota)`;
    const app =
        variant === "plain"
            ? `const app = createApp<Vars>();
app.use(requireUser); app.use(rid); app.use(lang); app.use(tenant); app.use(trace);
app${scoped.replaceAll(").use(", "); app.use(")};
`
            : variant === "chain"
              ? `const app = createApp<Vars>().use(requireUser).use(rid).use(lang).use(tenant).use(trace);
app${scoped.replaceAll(").use(", "); app.use(")};
`
              : `const app = createApp<Vars>().use(requireUser).use(rid).use(lang).use(tenant).use(trace)
    ${scoped};
`;

    // 全体の変数は、plain では ?. が要る
    const dot = variant === "plain" ? "?." : ".";
    const prefixes = ["/admin", "/orgs/:orgId", "/admin/audit", "/beta", "/api/v1", "/public", "/users/:id"];
    const scopedVar: Record<string, string> = { "/admin": "admin", "/orgs/:orgId": "org", "/admin/audit": "audit", "/beta": "beta", "/api/v1": "quota" };
    const lines: string[] = [];
    for (let i = 0; i < routes; i++) {
        const prefix = prefixes[i % prefixes.length]!;
        const path = `${prefix}/r${i}/:x${i}`;
        const name = scopedVar[prefix];
        // パスの下の変数は、scoped だけ ! なしで読む
        const under = name ? (variant === "scoped" ? `c.get("${name}")` : `c.get("${name}")!`) : "0";
        const body = `[c.get("user")${dot}name, c.get("rid"), c.get("lang"), ${under}]`;
        if (i % 3 === 0) lines.push(`app.get("${path}", { use: [requireUser] }, (p, c) => [p.x${i}, ...${body}]);`);
        else if (i % 3 === 1) lines.push(`app.post("${path}", (p, c) => [p.x${i}, ...${body}]);`);
        else lines.push(`app.put("${path}", (p, c) => [p.x${i}, ...${body}]);`);
    }
    writeFileSync(join(outDir, "app.ts"), `${head}${app}${lines.join("\n")}\nexport default app;\n`);
    writeFileSync(join(outDir, "tsconfig.json"), `${JSON.stringify({ extends: "../../../../tsconfig.json", include: ["app.ts"] }, null, 4)}\n`);
}

if (import.meta.main) {
    const [outDir, variant, routes, src] = process.argv.slice(2);
    if (!outDir || !VARIANTS.includes(variant as Variant) || !Number(routes)) {
        console.error("usage: bun bench/types/gen.ts <outDir> <plain|chain|scoped> <routes> [src]");
        process.exit(1);
    }
    generate(outDir, variant as Variant, Number(routes), src ?? "../../../../src/index.ts");
}
