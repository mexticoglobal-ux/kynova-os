// Sample data for the local simulation of AI Studio. Fictional companies, people and prompts. Built by applying events
// through the same reducer a real adapter will use, so loading it also proves the rules hold together. No provider is named.

import { demoAutomationsOk } from "./automation-demo";
import {
  DEFAULT_KOE_ENV, declareVariables, newStudioState, reduceStudio, type AgentContent, type Clearance, type Meta, type PromptContent, type StudioEnv, type StudioEvent, type StudioState,
} from "./studio-center";

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

// Who the simulation can act as. "worker:nex" is NEX: it may leave a draft and nothing else.
export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo", tenantId: "tenant-nova", actor: "pablo" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía", tenantId: "tenant-vida", actor: "lucia" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

/** What other modules expose to Studio: the company's automations (Automations) and courses (Academy), by id. */
export function demoStudioEnv(): StudioEnv {
  const automations = demoAutomationsOk().automations.map((item) => ({ id: item.id, tenantId: item.tenantId, name: item.name }));
  const courses = [
    { id: "course-ventas", tenantId: "tenant-nova", name: "Ventas para clínicas" },
    { id: "course-atencion", tenantId: "tenant-vida", name: "Atención al paciente" },
  ];
  return { ...DEFAULT_KOE_ENV, refs: { automations, courses } };
}

export const promptContent = (body: string, clearance: Clearance = "business", examples: Record<string, string> = {}): PromptContent => ({
  kind: "prompt", body, clearance, variables: declareVariables(body).map((item) => ({ ...item, example: examples[item.name] ?? "" })),
});
export const agentContent = (promptId: string, over: Partial<AgentContent> = {}): AgentContent => ({
  kind: "agent", promptId, workerIds: [], automationIds: [], courseIds: [], clearance: "business",
  memory: { mode: "session", maxEntries: 20, maxChars: 2_000 }, personality: { tone: "friendly", language: "es", style: "Breve y claro" },
  limits: { maxRunsPerDay: 50, maxStepsPerRun: 10, maxCostMicrosPerRun: 20_000 }, ...over,
});
export const meta = (name: string, category: Meta["category"] = "sales", tags: readonly string[] = [], description = ""): Meta => ({ name, description, category, tags });

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
export const PROSPECT_V1 = "Eres el asistente comercial de la empresa.\nResponde a {{nombre}} sobre {{tema}} con un tono cercano.\nNo prometas precios.";
export const PROSPECT_V2 = "Eres el asistente comercial de la empresa.\nResponde a {{nombre}} sobre {{tema}} con un tono cercano.\nPregunta por el presupuesto disponible.\nNo prometas precios.";

export function demoStudioState(env: StudioEnv = demoStudioEnv()): { state: StudioState; errors: string[] } {
  const errors: string[] = [];
  let state = newStudioState();
  const send = (event: StudioEvent) => {
    const result = reduceStudio(state, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const ana = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const nex = { tenantId: "tenant-nova", actor: "worker:nex" };
  const lucia = { tenantId: "tenant-vida", actor: "lucia" };
  const idOf = (name: string, tenantId = "tenant-nova") => state.assets.find((item) => item.name === name && item.tenantId === tenantId)?.id ?? "";
  const novaAutomation = env.refs.automations.find((item) => item.tenantId === "tenant-nova")?.id ?? "";

  send({ ...ana, at: day(1), type: "authorization.grant", maxPerDay: 10 }); // Level 2: connecting an agent to Workers, automations and courses

  send({ ...ana, at: day(1), type: "asset.create", kind: "prompt", meta: meta("Respuesta a prospecto", "sales", ["ventas", "primer-contacto"], "Primera respuesta a quien pide información."), content: promptContent(PROSPECT_V1, "business", { nombre: "Marta", tema: "precios" }) });
  send({ ...ana, at: day(1), type: "version.submit", assetId: idOf("Respuesta a prospecto"), versionNumber: 1 });
  send({ ...pablo, at: day(2), type: "version.approve", assetId: idOf("Respuesta a prospecto"), versionNumber: 1, note: "Listo para usar" });
  // NEX proposes an improvement: a new version in draft, sent to review; only a person can publish it
  send({ ...nex, at: day(3), type: "asset.save", assetId: idOf("Respuesta a prospecto"), content: promptContent(PROSPECT_V2, "business", { nombre: "Marta", tema: "precios" }), note: "NEX: preguntar por el presupuesto" });
  send({ ...nex, at: day(3), type: "version.submit", assetId: idOf("Respuesta a prospecto"), versionNumber: 2 });

  send({ ...ana, at: day(3), type: "asset.create", kind: "prompt", meta: meta("Resumen semanal", "analysis", ["reportes"], "Resume la semana para el equipo."), content: promptContent("Resume la semana {{periodo}} en cinco puntos para el equipo.", "business", { periodo: "del 1 al 7" }) });

  send({ ...ana, at: day(4), type: "asset.create", kind: "agent", meta: meta("Asistente comercial", "sales", ["ventas"], "Atiende a los prospectos con el prompt de primera respuesta."), content: agentContent(idOf("Respuesta a prospecto"), { workerIds: ["sales"], automationIds: novaAutomation ? [novaAutomation] : [], courseIds: ["course-ventas"] }) });
  send({ ...ana, at: day(4), type: "version.submit", assetId: idOf("Asistente comercial"), versionNumber: 1 });
  send({ ...pablo, at: day(5), type: "version.approve", assetId: idOf("Asistente comercial"), versionNumber: 1 });

  // the Playground: every test goes through KOE
  send({ ...ana, at: day(6), type: "test.run", assetId: idOf("Respuesta a prospecto"), versionNumber: 1, inputs: { nombre: "Marta Solís", tema: "el plan anual" } });
  send({ ...ana, at: day(6), type: "test.compare", assetId: idOf("Respuesta a prospecto"), a: 1, b: 2, inputs: { nombre: "Marta Solís", tema: "el plan anual" } });
  send({ ...ana, at: day(6), type: "test.run", assetId: idOf("Asistente comercial"), versionNumber: 1, inputs: { nombre: "Carlos Mena", tema: "una demostración" } });

  // a template (the model for a future library) and a draft made from it; a share proposal, architecture only
  send({ ...ana, at: day(7), type: "template.create", assetId: idOf("Respuesta a prospecto"), versionNumber: 1 });
  send({ ...ana, at: day(7), type: "asset.fromTemplate", templateId: state.templates[0]?.id ?? "" });
  send({ ...ana, at: day(7), type: "share.propose", assetId: idOf("Respuesta a prospecto"), versionNumber: 1, toTenantId: "tenant-vida" });
  send({ ...ana, at: day(8), type: "share.approve", shareId: state.shares[0]?.id ?? "" });

  send({ ...lucia, at: day(2), type: "asset.create", kind: "prompt", meta: meta("Aviso de cita", "support", ["citas"], "Recuerda una cita al paciente."), content: promptContent("Recuerda a {{paciente}} su cita del {{fecha}} con amabilidad.", "personal", { paciente: "Ana", fecha: "12 de noviembre" }) });
  send({ ...lucia, at: day(2), type: "version.submit", assetId: idOf("Aviso de cita", "tenant-vida"), versionNumber: 1 });
  return { state, errors };
}

export const demoStudioOk = (): StudioState => {
  const { state, errors } = demoStudioState();
  if (errors.length) throw new Error(errors.join("; "));
  return state;
};
