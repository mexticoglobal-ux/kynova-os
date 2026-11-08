// Sample data for the local simulation of the Billing & Subscription Center. Fictional companies and invented prices. Built by applying events
// through the same reducer a real adapter will use, so loading it also proves the rules hold together. The use of the platform comes from KOE's
// own sample records (Worker runs) and from the other modules' samples; nothing here reaches a payment provider.

import { demoAcademyOk } from "./academy-demo";
import { demoCommsOk } from "./comms-demo";
import { DEMO_NOW, demoCrmOk } from "./crm-demo";
import { demoInsightsSource } from "./insights-demo";
import { demoOk as demoMarketOk } from "./marketplace-demo";
import { demoOrgOk } from "./org-demo";
import { DEFAULT_KOE_ENV, newBillingState, reduceBilling, type BillingEnv, type BillingEvent, type BillingState } from "./billing-center";
import { usageFrom, type UsageSample } from "./koe-billing";

export { DEMO_NOW };
export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana (propietaria)", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo (administra la facturación)", tenantId: "tenant-nova", actor: "pablo" },
  { id: "nova-carla", label: "Nova · Carla (ventas)", tenantId: "tenant-nova", actor: "carla" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía (propietaria)", tenantId: "tenant-vida", actor: "lucia" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

const ago = (days: number, hours = 0) => new Date(Date.parse(DEMO_NOW) - days * 86_400_000 - hours * 3_600_000).toISOString();

export type BillingSource = { state: BillingState; env: BillingEnv; errors: string[] };

export function demoBillingSource(): BillingSource {
  const insights = demoInsightsSource();
  const org = demoOrgOk().state;
  const parts = {
    org, koe: insights.koe, automation: insights.automations, academy: demoAcademyOk(), market: demoMarketOk(), studio: insights.studio, insights: insights.state, crm: demoCrmOk(), comms: demoCommsOk().state,
  };
  // what the other modules do not hold yet is measured by the platform: storage (GB), API calls this month and connections
  const measured: UsageSample[] = [
    { tenantId: "tenant-nova", resource: "storage", used: 62, previous: 41 }, { tenantId: "tenant-nova", resource: "api", used: 41_000, previous: 30_000 }, { tenantId: "tenant-nova", resource: "integrations", used: 6, previous: 5 },
    { tenantId: "tenant-vida", resource: "storage", used: 3 }, { tenantId: "tenant-vida", resource: "api", used: 900 }, { tenantId: "tenant-vida", resource: "integrations", used: 2 },
  ];
  const usage = [...usageFrom({ ...parts, measured }, "tenant-nova", DEMO_NOW), ...usageFrom({ ...parts, measured }, "tenant-vida", DEMO_NOW)];
  const env: BillingEnv = { ...DEFAULT_KOE_ENV, signals: { executions: insights.executions, usage } };

  const errors: string[] = [];
  let state = newBillingState();
  const send = (event: BillingEvent) => {
    const result = reduceBilling(state, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const system = { tenantId: "tenant-nova", actor: "system" };
  const ana = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const nex = { tenantId: "tenant-nova", actor: "worker:nex" };

  // ---- Nova: Professional since two months ago, with two add-ons, one paid invoice, a credit and NEX's proposals
  send({ ...system, at: ago(58), type: "account.create", ownerId: "ana", planId: "professional" });
  send({ ...ana, at: ago(58, -1), type: "billing.setAdmin", userId: "pablo", enabled: true });
  send({ ...ana, at: ago(50), type: "addon.purchase", addon: "extraWorkers", quantity: 1 });
  send({ ...pablo, at: ago(40), type: "addon.purchase", addon: "aiCredits", quantity: 1 });
  send({ ...pablo, at: ago(28), type: "renewal.run" });
  const first = state.invoices.find((item) => item.tenantId === "tenant-nova");
  if (first) send({ ...pablo, at: ago(27), type: "payment.record", invoiceId: first.id, amountMicros: first.totalMicros, method: "simulatedCard" });
  send({ ...ana, at: ago(10), type: "credit.add", amountMicros: 20_000_000, reason: "Compensación por una demora de soporte" });
  send({ ...nex, at: ago(6), type: "proposal.create", payload: { kind: "addon", addon: "storage", quantity: 1 }, reason: "El almacenamiento va a pasar del 80 % en el próximo mes" });
  send({ ...pablo, at: ago(5), type: "authorization.grant", maxPerDay: 1, expiresAt: ago(-30) });
  send({ ...nex, at: ago(2), type: "upgrade.request", toPlanId: "business", reason: "Las tareas de KOE y los usuarios crecen más rápido que el plan" });
  send({ ...nex, at: ago(1), type: "billing.analyze" });

  // ---- Clínica Vida: in its free trial of Starter, isolated from Nova in everything
  const vida = { tenantId: "tenant-vida", actor: "lucia" };
  send({ tenantId: "tenant-vida", actor: "system", at: ago(5), type: "account.create", ownerId: "lucia", planId: "starter", trial: true });
  send({ ...vida, at: ago(4), type: "addon.purchase", addon: "extraUsers", quantity: 1 });
  return { state, env, errors };
}

export const demoBillingOk = (): BillingSource => {
  const source = demoBillingSource();
  if (source.errors.length) throw new Error(source.errors.join("; "));
  return source;
};
