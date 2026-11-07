import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { AcademyCenter } from "../_components/AcademyCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("academy");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="academy">
      <AcademyCenter />
    </SectionShell>
  );
}
