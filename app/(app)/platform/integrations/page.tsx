import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { IntegrationsCenter } from "../_components/IntegrationsCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("integrations");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="integrations">
      <IntegrationsCenter />
    </SectionShell>
  );
}
