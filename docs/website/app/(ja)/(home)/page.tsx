import { HomePage, homeMetadata } from "@/components/pages/home";

export const metadata = homeMetadata("ja");

export default function Page() {
    return <HomePage lang="ja" />;
}
