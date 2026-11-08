import type { ReactNode } from "react";
import { Root, rootMetadata } from "@/components/pages/root";
import "@/app/global.css";

export const metadata = rootMetadata("ja");

export default function Layout({ children }: { children: ReactNode }) {
    return <Root lang="ja">{children}</Root>;
}
