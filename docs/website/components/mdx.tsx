// MDX の中で使える部品
// - Fumadocs の標準(コードブロック、注意書き Callout、カードなど)
// - ファイルの木(Files / Folder / File)、ステップ(Steps / Step)、タブ(Tabs / Tab)
// - 型の表(TypeTable は手で書く、AutoTypeTable は TypeScript の型から作る)
// - Twoslash の型ヒントのポップアップ、Mermaid の図
import { AutoTypeTable } from "fumadocs-typescript/ui";
import { createGenerator } from "fumadocs-typescript";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultMdxComponents from "fumadocs-ui/mdx";
import * as Twoslash from "fumadocs-twoslash/ui";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { Mermaid } from "./mermaid";

// AutoTypeTable の path は docs/website から見たパス(例: ../../src/multipart.ts)
const generator = createGenerator({ cache: false });

export function getMDXComponents(components?: MDXComponents) {
    return {
        ...defaultMdxComponents,
        ...Twoslash,
        File,
        Files,
        Folder,
        Step,
        Steps,
        Tab,
        Tabs,
        TypeTable,
        AutoTypeTable: (props: Omit<ComponentProps<typeof AutoTypeTable>, "generator">) => <AutoTypeTable {...props} generator={generator} />,
        Mermaid,
        ...components,
    } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
    type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
