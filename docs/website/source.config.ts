// MDX の読み込みの設定(fumadocs-mdx)。ドキュメントとブログの2つのコレクションを作る
import { defineCollections, defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { rehypeCodeDefaultOptions, remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createFileSystemTypesCache } from "fumadocs-twoslash/cache-fs";
import convert from "npm-to-yarn";
import { z } from "zod";
import { denoCommand } from "./lib/deno";
import { senriCompilerOptions } from "./lib/senri-types";

export const docs = defineDocs({
    dir: "content/docs",
    docs: {
        schema: pageSchema,
        postprocess: {
            // llms.txt と「Markdown でコピー」のため
            includeProcessedMarkdown: true,
        },
    },
    meta: {
        schema: metaSchema,
    },
});

// ブログ(リリースのお知らせ)。content/blog/ja/*.mdx と content/blog/en/*.mdx
export const blog = defineCollections({
    type: "doc",
    dir: "content/blog",
    schema: pageSchema.extend({
        date: z.coerce.date(),
        author: z.string().optional(),
    }),
});

export default defineConfig({
    mdxOptions: {
        // ```mermaid のコードブロックを <Mermaid chart="..." /> にする
        remarkPlugins: [remarkMdxMermaid],
        // ```npm のコードブロックを、npm / pnpm / yarn / bun / deno のタブにする
        remarkNpmOptions: {
            persist: { id: "package-manager" },
            // npm / pnpm / yarn / bun は remarkNpm の既定と同じ(npm-to-yarn で変換)。Deno を足す
            packageManagers: [
                { name: "npm", command: (cmd) => cmd },
                ...(["pnpm", "yarn", "bun"] as const).map((pm) => ({
                    name: pm,
                    command: (cmd: string) =>
                        cmd
                            .split("\n")
                            .map((l) => convert(l, pm))
                            .join("\n"),
                })),
                { name: "deno", command: denoCommand },
            ],
        },
        rehypeCodeOptions: {
            themes: { light: "github-light", dark: "github-dark" },
            // ```ts twoslash のコードブロックに、型のヒントを付ける。@senrijs/senri はリポジトリの src を読む
            transformers: [
                ...(rehypeCodeDefaultOptions.transformers ?? []),
                transformerTwoslash({
                    typesCache: createFileSystemTypesCache(),
                    twoslashOptions: { compilerOptions: senriCompilerOptions },
                }),
            ],
            langs: ["ts", "tsx", "js", "json", "bash", "sh", "toml", "jsonc"],
        },
    },
});
