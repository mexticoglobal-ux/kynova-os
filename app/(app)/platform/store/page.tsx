import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { MarketplaceCenter } from "../_components/MarketplaceCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("store");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="store">
      <MarketplaceCenter />
    </SectionShell>
  );
}
