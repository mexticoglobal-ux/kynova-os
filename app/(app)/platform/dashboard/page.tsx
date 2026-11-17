import { LayoutDashboard } from "lucide-react";
import { pageMetadata } from "@/lib/seo/metadata";
import { loadServerSession } from "@/lib/auth/session";
import { runInternalBeta, BETA_NOW } from "@/lib/contracts/platform/internal-beta";
import { betaDashboard, viewerOfMemberships, NO_INFO } from "@/lib/nex/execution-bridge/beta-dashboard";
import { EmptyState } from "@/components/ui/EmptyState";
import { sectionInfo } from "../_components/catalog";
import { BetaDashboardView } from "../_components/BetaDashboardView";
import { SectionShell } from "../_components/SectionShell";

const info = sectionInfo("dashboard");

export const metadata = pageMetadata({ title: info.title, description: info.summary, path: info.href });

// Two separate paths. DEMO (no backend configured): the platform owner over the four Internal Beta companies' sample records, labelled as simulated. SIGNED IN: the viewer and the company come from the
// server session (memberships re-read by the backend; `?empresa=` is only a preference and is checked against them). No real company has a data source connected yet, so each one says Sin información.
export default async function Page({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams;
  const state = await loadServerSession();
  if (state.kind === "backend") {
    const own = viewerOfMemberships(state.session.memberships, state.active?.tenantId, empresa);
    const name = state.session.memberships.find((row) => row.tenantId === own?.tenantId)?.name;
    return (
      <SectionShell section="dashboard">
        <EmptyState icon={LayoutDashboard} title={NO_INFO}>{name ? `${name}: ` : ""}todavía no hay fuentes reales conectadas para esta empresa.</EmptyState>
      </SectionShell>
    );
  }
  const beta = runInternalBeta();
  const viewer = { tenantIds: beta.tenants.map((row) => row.spec.id), role: "owner" };
  const result = betaDashboard({ beta }, viewer, empresa ?? viewer.tenantIds[0] ?? "", BETA_NOW);
  return (
    <SectionShell section="dashboard">
      {result.ok ? <BetaDashboardView data={result.dashboard} simulated /> : <EmptyState icon={LayoutDashboard} title={NO_INFO}>La empresa pedida no existe o no está entre las suyas.</EmptyState>}
    </SectionShell>
  );
}
