import { BlogIndex, blogIndexMetadata } from "@/components/pages/blog";

export const metadata = blogIndexMetadata("en");

export default function Page() {
    return <BlogIndex lang="en" />;
}
