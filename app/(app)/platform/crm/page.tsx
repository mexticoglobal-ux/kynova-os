import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { CrmCenter } from "../_components/CrmCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("crm");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="crm">
      <CrmCenter />
    </SectionShell>
  );
}
