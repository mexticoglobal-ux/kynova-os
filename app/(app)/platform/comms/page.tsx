import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { CommsCenter } from "../_components/CommsCenter";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("comms");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="comms">
      <CommsCenter />
    </SectionShell>
  );
}
