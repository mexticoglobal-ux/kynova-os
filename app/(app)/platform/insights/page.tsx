import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { InsightsCenter } from "../_components/InsightsCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("insights");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="insights">
      <InsightsCenter />
    </SectionShell>
  );
}
