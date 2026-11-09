// プレイグラウンドの Worker(playground/worker.ts)を、public/playground/worker.js にまとめる
// next build と next dev の前に bun で動かす。できたファイルは Git に入れない
// このパスにだけ、public/_headers で CSP(default-src 'none'; script-src 'self' 'unsafe-eval')を付ける
import { join } from "node:path";

// サイトの型検査(next build)には Bun の型がないので、使う分だけ書いておく
declare const Bun: {
    build(options: { entrypoints: string[]; outdir: string; naming: string; target: string; format: string; minify: boolean }): Promise<{
        success: boolean;
        logs: unknown[];
        outputs: { size: number }[];
    }>;
};

const WEBSITE = join(import.meta.dirname, "..");
const result = await Bun.build({
    entrypoints: [join(WEBSITE, "playground", "worker.ts")],
    outdir: join(WEBSITE, "public", "playground"),
    naming: "worker.js",
    target: "browser",
    format: "esm",
    minify: true,
});
if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}
const out = result.outputs[0]!;
console.log(`public/playground/worker.js を書き出しました(${(out.size / 1024).toFixed(1)} KB)`);
