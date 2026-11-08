import type { ReactNode } from "react";
import { DocsShell } from "@/components/pages/docs";

export default function Layout({ children }: { children: ReactNode }) {
    return <DocsShell lang="ja">{children}</DocsShell>;
}
