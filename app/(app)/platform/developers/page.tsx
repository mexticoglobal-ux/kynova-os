import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { DevCenter } from "../_components/DevCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("developers");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="developers">
      <DevCenter />
    </SectionShell>
  );
}
