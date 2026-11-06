import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { ReferralsSection } from "../_components/Sections";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("referrals");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="referrals">
      <ReferralsSection />
    </SectionShell>
  );
}
