import type { ReactNode } from "react";
import { Root, rootMetadata } from "@/components/pages/root";
import "@/app/global.css";

export const metadata = rootMetadata("en");

export default function Layout({ children }: { children: ReactNode }) {
    return <Root lang="en">{children}</Root>;
}
