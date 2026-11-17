import { LayoutDashboard } from "lucide-react";
import { redirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo/metadata";
import { loadServerSession } from "@/lib/auth/session";
import { runInternalBeta, BETA_NOW } from "@/lib/contracts/platform/internal-beta";
import { createBackend } from "@/lib/db/backend";
import { createSupabaseSpikeServerClient } from "@/lib/db/supabase-spike";
import { betaDashboard, liveDashboard, viewerOfMemberships, NO_INFO } from "@/lib/nex/execution-bridge/beta-dashboard";
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
  // With a backend configured the demo is never a fallback: no valid session goes to the existing sign-in (the layout does the same), and an unreachable server shows nothing.
  if (state.kind === "anonymous") redirect("/login");
  if (state.kind === "unavailable") return <SectionShell section="dashboard"><EmptyState icon={LayoutDashboard} title={NO_INFO}>No pudimos conectar con el servidor.</EmptyState></SectionShell>;
  if (state.kind === "backend") {
    const own = viewerOfMemberships(state.session.memberships, state.active?.tenantId, empresa);
    // The one persisted source so far is the company's activity trail (the backend's `listActivity`); the rest of the sections say Sin información until their sources exist.
    const live = own ? await liveDashboard(state.session.memberships, own.tenantId, new Date().toISOString(), async (id) => createBackend(await createSupabaseSpikeServerClient()).listActivity(id, 8)) : null;
    return (
      <SectionShell section="dashboard">
        {live?.ok ? <BetaDashboardView data={live.dashboard} /> : <EmptyState icon={LayoutDashboard} title={NO_INFO}>No hay una empresa autorizada para mostrar.</EmptyState>}
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
