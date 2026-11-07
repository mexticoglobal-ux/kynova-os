import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { OrgCenter } from "../_components/OrgCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("org");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="org">
      <OrgCenter />
    </SectionShell>
  );
}
