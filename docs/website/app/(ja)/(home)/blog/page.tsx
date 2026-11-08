import { BlogIndex, blogIndexMetadata } from "@/components/pages/blog";

export const metadata = blogIndexMetadata("ja");

export default function Page() {
    return <BlogIndex lang="ja" />;
}
