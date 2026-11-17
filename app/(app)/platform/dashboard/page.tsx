import { LayoutDashboard } from "lucide-react";
import { pageMetadata } from "@/lib/seo/metadata";
import { runInternalBeta, BETA_NOW } from "@/lib/contracts/platform/internal-beta";
import { betaDashboard, NO_INFO } from "@/lib/nex/execution-bridge/beta-dashboard";
import { EmptyState } from "@/components/ui/EmptyState";
import { sectionInfo } from "../_components/catalog";
import { BetaDashboardView } from "../_components/BetaDashboardView";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("dashboard");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

// Preview: the viewer is the platform owner of the four Internal Beta companies, over the Beta's sample records. When real data exists, only the viewer and the sources change.
export default async function Page({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams;
  const beta = runInternalBeta();
  const viewer = { tenantIds: beta.tenants.map((row) => row.spec.id), role: "owner" };
  const tenantId = empresa ?? viewer.tenantIds[0] ?? "";
  const result = betaDashboard({ beta }, viewer, tenantId, BETA_NOW);
  return (
    <SectionShell section="dashboard">
      {result.ok ? <BetaDashboardView data={result.dashboard} /> : <EmptyState icon={LayoutDashboard} title={NO_INFO}>La empresa pedida no existe o no está entre las suyas.</EmptyState>}
    </SectionShell>
  );
}
