import { llms, loader } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { blog, docs } from "collections/server";
import { i18n } from "./i18n";

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
    baseUrl: "/docs",
    i18n,
    source: docs.toFumadocsSource(),
});

export const blogSource = loader({
    baseUrl: "/blog",
    i18n,
    source: toFumadocsSource(blog, []),
});

// テストと結ぶしるし({/* verify: ... */}。README の「書いた動きをテストで確かめる」)は、Markdown には出さない
// (処理したあとの Markdown には、MDX のコメントが文字のまま残るため)。行の終わりの空白と、しるしだけの行も消す
const stripClaimMarkers = (text: string) => text.replace(/ ?\{\/\*\s*verify:[^*]*\*\/\}/g, "").replace(/\n\n(?=\n)/g, "\n");

export const docsLlms = llms(source, {
    renderPage: async (page) => `# ${page.data.title} (${page.url})

${stripClaimMarkers(await page.data.getText("processed"))}`,
});
