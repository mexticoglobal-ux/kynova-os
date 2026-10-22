import { getBlueprintsService } from "@/modules/blueprints";
import { getEmployeeFramework } from "@/platform/ai-employees";
import { getBusinessProfileService } from "@/platform/business-profile";
import { companyHealth, getCompanyIntegrationsService, type Actor, type CompanyHealth, type HealthInput } from "@/platform/integrations";

/**
 * Composition root for Company Health: the one place that reads the Business Profile, the installed Blueprint, the AI team and the integrations
 * together. The Integrations Framework itself depends on none of them; this file depends on all of them.
 * A source that cannot be read counts as 0%, never as a guess.
 */
export async function gatherHealthInput(a: Actor): Promise<HealthInput> {
  const [bp, blueprint, team, ig] = await Promise.all([
    getBusinessProfileService().then((s) => s.state(a)).catch(() => null),
    getBlueprintsService().then((s) => s.current(a)).catch(() => null),
    Promise.resolve().then(() => getEmployeeFramework().employees.list(a)).catch(() => []),
    getCompanyIntegrationsService().then((s) => s.summary(a)),
  ]);
  const staff = team.filter((e) => e.status !== "retired"), active = staff.filter((e) => e.status === "active").length;
  return {
    profilePct: bp?.profilePct ?? 0, dnaPct: bp?.dnaPct ?? 0, blueprintPct: blueprint?.health.score ?? 0, teamPct: staff.length ? Math.round((active / staff.length) * 100) : 0,
    integrations: { available: ig.totals.available, connected: ig.totals.connected, pending: ig.totals.pending },
  };
}
export async function getCompanyHealth(a: Actor): Promise<{ health: CompanyHealth; input: HealthInput }> {
  const input = await gatherHealthInput(a); return { health: companyHealth(input), input };
}
