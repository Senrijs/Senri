// Twoslash(コードの型ヒント)が @senrijs/senri を読むときの設定
// 公開している dist ではなく、リポジトリの src / adapters を直接読む(ルートでのビルドが要らず、PR で変えた型がそのまま出る)
// 対応は jsr.json の exports と同じ。tsconfig.json の paths にも同じものを書いている
import { resolve } from "node:path";

// サイトのビルドは docs/website で動かす
const ROOT = resolve(process.cwd(), "../..");

export const senriExports: Record<string, string> = {
    "@senrijs/senri": "src/index.ts",
    "@senrijs/senri/dev": "src/dev/index.ts",
    "@senrijs/senri/cookie": "src/cookie.ts",
    "@senrijs/senri/ip": "src/ip.ts",
    "@senrijs/senri/streaming": "src/streaming.ts",
    "@senrijs/senri/multipart": "src/multipart.ts",
    "@senrijs/senri/problem": "src/problem.ts",
    "@senrijs/senri/jwt": "src/jwt.ts",
    "@senrijs/senri/client": "src/client.ts",
    "@senrijs/senri/testing": "src/testing.ts",
    "@senrijs/senri/websocket": "src/websocket.ts",
    "@senrijs/senri/node": "adapters/node/index.ts",
    "@senrijs/senri/serve": "adapters/serve/index.ts",
    "@senrijs/senri/static": "adapters/static/index.ts",
    "@senrijs/senri/context-storage": "adapters/context-storage/index.ts",
};

export const senriCompilerOptions = {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    lib: ["esnext", "dom", "dom.iterable"],
    strict: true,
    noEmit: true,
    // src は import "./router.ts" のように拡張子つきで書いている
    allowImportingTsExtensions: true,
    paths: Object.fromEntries(Object.entries(senriExports).map(([name, file]) => [name, [resolve(ROOT, file).replaceAll("\\", "/")]])),
};
