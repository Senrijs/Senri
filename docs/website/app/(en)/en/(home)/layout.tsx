import type { ReactNode } from "react";
import { HomeShell } from "@/components/pages/home";

export default function Layout({ children }: { children: ReactNode }) {
    return <HomeShell lang="en">{children}</HomeShell>;
}
