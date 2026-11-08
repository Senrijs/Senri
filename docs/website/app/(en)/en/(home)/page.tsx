import { HomePage, homeMetadata } from "@/components/pages/home";

export const metadata = homeMetadata("en");

export default function Page() {
    return <HomePage lang="en" />;
}
