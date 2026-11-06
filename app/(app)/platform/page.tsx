import { pageMetadata } from "@/lib/seo/metadata";
import { PLATFORM_HUB } from "./_components/catalog";
import { PlatformHub } from "./_components/PlatformHub";

export const metadata = pageMetadata({ title: PLATFORM_HUB.title, description: PLATFORM_HUB.summary, path: "/platform" });

export default function PlatformPage() {
  return <PlatformHub />;
}
