import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { PaymentsSection } from "../_components/Sections";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("payments");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="payments">
      <PaymentsSection />
    </SectionShell>
  );
}
