// 検索の索引。静的書き出しでは、ビルドのときに JSON のファイル(out/api/search)として書き出す
// 検索そのものはブラウザの中で行う(components/search.tsx)。日本語も英語も、標準の多言語のトークナイザーで分ける
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
