import { pageMetadata } from "@/lib/seo/metadata";
import { sectionInfo } from "../_components/catalog";
import { ConnectedApps } from "../_components/ConnectedApps";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("connectedApps");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

export default function Page() {
  return (
    <SectionShell section="connectedApps">
      <ConnectedApps />
    </SectionShell>
  );
}
