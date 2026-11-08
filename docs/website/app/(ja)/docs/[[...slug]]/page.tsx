import { DocsContent, docsMetadata, docsParams } from "@/components/pages/docs";

type Props = { params: Promise<{ slug?: string[] }> };

export const dynamicParams = false;

export default async function Page({ params }: Props) {
    return <DocsContent lang="ja" slug={(await params).slug} />;
}

export function generateStaticParams() {
    return docsParams("ja");
}

export async function generateMetadata({ params }: Props) {
    return docsMetadata("ja", (await params).slug);
}
