import { DocsContent, docsMetadata, docsParams } from "@/components/pages/docs";

type Props = { params: Promise<{ slug?: string[] }> };

export const dynamicParams = false;

export default async function Page({ params }: Props) {
    return <DocsContent lang="en" slug={(await params).slug} />;
}

export function generateStaticParams() {
    return docsParams("en");
}

export async function generateMetadata({ params }: Props) {
    return docsMetadata("en", (await params).slug);
}
