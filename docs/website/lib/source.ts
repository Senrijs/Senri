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

export const docsLlms = llms(source, {
    renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});
