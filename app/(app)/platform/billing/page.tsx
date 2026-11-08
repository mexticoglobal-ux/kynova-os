import { pageMetadata } from "@/lib/seo/metadata";
import { BillingCenter } from "../_components/BillingCenter";
import { sectionInfo } from "../_components/catalog";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("billing");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="billing">
      <BillingCenter />
    </SectionShell>
  );
}
