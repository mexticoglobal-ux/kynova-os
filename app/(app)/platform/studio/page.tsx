import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { StudioCenter } from "../_components/StudioCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("studio");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="studio">
      <StudioCenter />
    </SectionShell>
  );
}
