// Sample data for the local simulation of the Developer Platform. Fictional companies and invented, clearly fake credentials. Built by applying events
// through the same reducer a real adapter will use, so loading it also proves the rules hold together. Nothing here reaches a network.

import { DEMO_NOW } from "./crm-demo";
import { DEFAULT_KOE_ENV, newDevState, reduceDev, type DevEnv, type DevEvent, type DevState, type Reveal } from "./dev-center";

export { DEMO_NOW };
export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana (propietaria)", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo (desarrolla)", tenantId: "tenant-nova", actor: "pablo" },
  { id: "nova-carla", label: "Nova · Carla (ventas)", tenantId: "tenant-nova", actor: "carla" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía (propietaria)", tenantId: "tenant-vida", actor: "lucia" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

const ago = (days: number, hours = 0, seconds = 0) => new Date(Date.parse(DEMO_NOW) - days * 86_400_000 - hours * 3_600_000 - seconds * 1_000).toISOString();

export type DevSource = { state: DevState; env: DevEnv; errors: string[] };

export function demoDevSource(): DevSource {
  const env: DevEnv = { ...DEFAULT_KOE_ENV, signals: {} };
  const errors: string[] = [];
  let state = newDevState();
  const reveals: Reveal[] = [];
  const send = (event: DevEvent) => {
    const result = reduceDev(state, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    if (result.reveal) reveals.push(result.reveal);
    state = result.state;
  };
  const system = { tenantId: "tenant-nova", actor: "system" };
  const ana = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const nex = { tenantId: "tenant-nova", actor: "worker:nex" };
  const app = (name: string) => state.apps.find((item) => item.name === name && item.tenantId === "tenant-nova")?.id ?? "";
  const key = (name: string) => state.keys.find((item) => item.name === name && item.tenantId === "tenant-nova")?.id ?? "";

  // ---- Nova: Professional, two people who build, three apps, keys in every state, two webhooks, a sandbox, a month of use and NEX's proposals
  send({ ...system, at: ago(70), type: "dev.create", ownerId: "ana", planId: "professional" });
  send({ ...ana, at: ago(70, -1), type: "dev.setDeveloper", userId: "pablo", enabled: true });
  send({ ...pablo, at: ago(65), type: "app.create", name: "Nova CRM Sync", appKind: "connector", description: "Sincroniza prospectos y conversaciones con el CRM de Nova", scopes: ["crm.read", "crm.write", "comms.read"], rateLimitRpm: 120 });
  send({ ...pablo, at: ago(64), type: "app.setStatus", appId: app("Nova CRM Sync"), to: "active" });
  send({ ...pablo, at: ago(60), type: "key.create", appId: app("Nova CRM Sync"), name: "Prueba antigua", scopes: ["comms.read"] });
  send({ ...pablo, at: ago(55), type: "key.create", appId: app("Nova CRM Sync"), name: "Sync lectura", scopes: ["crm.read"] });
  send({ ...pablo, at: ago(50), type: "key.revoke", keyId: key("Sync lectura") });
  send({ ...pablo, at: ago(40), type: "key.create", appId: app("Nova CRM Sync"), name: "Sync CRM", scopes: ["crm.read", "crm.write"], rateLimitRpm: 100 });
  send({ ...ana, at: ago(35), type: "app.create", name: "Reportes Nova", appKind: "app", description: "Reportes semanales para el equipo", scopes: ["insights.read", "org.read"], apiVersion: "v0", rateLimitRpm: 60 });
  send({ ...ana, at: ago(34), type: "app.setStatus", appId: app("Reportes Nova"), to: "active" });
  send({ ...pablo, at: ago(20), type: "key.create", appId: app("Reportes Nova"), name: "Reportes", scopes: ["insights.read"], expiresAt: ago(-10), rateLimitRpm: 40 });
  // the sandbox first, with no errors, so the sample webhooks deliver; then it is tuned to show a latency and a rate of errors
  send({ ...pablo, at: ago(30), type: "sandbox.create", name: "Pruebas Nova", latencyMs: 80, errorRatePercent: 0 });
  send({ ...pablo, at: ago(29), type: "webhook.create", url: "https://hooks.nova.example/kynova", events: ["crm.lead.created", "comms.message.received"], appId: app("Nova CRM Sync") });
  send({ ...pablo, at: ago(28), type: "webhook.create", url: "https://fail.nova.example/hook", events: ["comms.message.received"] });
  send({ ...pablo, at: ago(6), type: "sandbox.emit", event: "crm.lead.created" });
  send({ ...pablo, at: ago(5), type: "sandbox.emit", event: "comms.message.received" });
  send({ ...pablo, at: ago(4), type: "sandbox.emit", event: "comms.message.received" });
  send({ ...pablo, at: ago(3, 12), type: "sandbox.emit", event: "comms.message.received" });
  const failing = state.deliveries.find((item) => item.tenantId === "tenant-nova" && item.status === "failed");
  if (failing) send({ ...pablo, at: ago(3), type: "webhook.retry", deliveryId: failing.id });
  send({ ...pablo, at: ago(2), type: "sandbox.configure", sandboxId: state.sandboxes[0]?.id ?? "", latencyMs: 120, errorRatePercent: 5 });
  // a month of use reported by the platform, and a minute that is close to the key's limit
  for (let day = 1; day <= 25; day += 1) {
    send({ ...system, at: ago(day, 3), type: "usage.report", keyId: key("Sync CRM"), endpointId: day % 3 === 0 ? "leads.create" : "leads.list", count: 180 + ((day * 37) % 60), errors: (day * 3) % 5 });
    if (day % 2 === 0) send({ ...system, at: ago(day, 5), type: "usage.report", keyId: key("Reportes"), endpointId: "insights.summary", count: 40 + ((day * 11) % 20), errors: day % 3 === 0 ? 1 : 0 });
  }
  send({ ...system, at: ago(0, 0, 20), type: "usage.report", keyId: key("Sync CRM"), endpointId: "leads.list", count: 85, errors: 0 });
  // NEX prepares; a person decides
  send({ ...nex, at: ago(2), type: "proposal.create", payload: { kind: "app", name: "Prompt Pack Ventas", appKind: "prompt", description: "Prompts de seguimiento de ventas", scopes: ["workers.read"], apiVersion: "v1" }, reason: "El equipo de ventas pidió compartir sus prompts" });
  const appProposal = state.proposals.find((item) => item.tenantId === "tenant-nova" && item.payload.kind === "app");
  if (appProposal) send({ ...ana, at: ago(1, 20), type: "proposal.approve", proposalId: appProposal.id });
  send({ ...nex, at: ago(1), type: "proposal.create", payload: { kind: "key", appId: app("Reportes Nova"), name: "Reportes v1", scopes: ["insights.read"] }, reason: "La llave actual expira pronto" });
  send({ ...nex, at: ago(0, 6), type: "proposal.create", payload: { kind: "webhook", url: "https://hooks.nova.example/reportes", events: ["billing.invoice.issued"] }, reason: "Avisar cuando se emita una factura" });
  send({ ...pablo, at: ago(0, 5), type: "authorization.grant", maxPerDay: 1, expiresAt: ago(-30) });
  send({ ...nex, at: ago(0, 4), type: "publication.request", appId: app("Nova CRM Sync"), note: "Listo para revisión del Marketplace" });
  send({ ...nex, at: ago(0, 1), type: "dev.analyze" });

  // ---- Clínica Vida: Starter, one app and one key, isolated from Nova in everything
  const vida = { tenantId: "tenant-vida", actor: "lucia" };
  send({ tenantId: "tenant-vida", actor: "system", at: ago(20), type: "dev.create", ownerId: "lucia", planId: "starter" });
  send({ ...vida, at: ago(19), type: "app.create", name: "Vida Citas", appKind: "app", description: "Agenda de citas", scopes: ["crm.read"], rateLimitRpm: 30 });
  const vidaApp = state.apps.find((item) => item.tenantId === "tenant-vida")?.id ?? "";
  send({ ...vida, at: ago(18), type: "key.create", appId: vidaApp, name: "Citas", scopes: ["crm.read"] });
  const vidaKey = state.keys.find((item) => item.tenantId === "tenant-vida")?.id ?? "";
  for (let day = 1; day <= 5; day += 1) send({ tenantId: "tenant-vida", actor: "system", at: ago(day, 2), type: "usage.report", keyId: vidaKey, endpointId: "leads.list", count: 30 + day, errors: 0 });
  return { state, env, errors };
}

export const demoDevOk = (): DevSource => {
  const source = demoDevSource();
  if (source.errors.length) throw new Error(source.errors.join("; "));
  return source;
};
