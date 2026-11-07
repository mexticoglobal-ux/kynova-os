// Sample data for the local simulation of the Workers center. Fictional companies, people and work. It is built by applying
// events through the same engine a real adapter will use, so loading it also proves the rules hold together.

import { newKoeState, reduceKoe, type KoeEvent, type KoeState, type WorkerInput, workerActor } from "./koe-engine";

export const PLATFORM_TENANT = "tenant-kynova";
export const DEMO_ADMINS = ["admin:ana", "admin:bruno"] as const;

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
  { id: PLATFORM_TENANT, name: "KYNOVA (plataforma)" },
] as const;

// Who the simulation can act as. A Worker is not a persona: when a person presses "ejecutar paso", the step is taken AS that Worker.
export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo (segunda persona)", tenantId: "tenant-nova", actor: "pablo" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía", tenantId: "tenant-vida", actor: "lucia" },
  { id: "admin-ana", label: "Administración · Ana", tenantId: PLATFORM_TENANT, actor: "admin:ana" },
  { id: "admin-bruno", label: "Administración · Bruno", tenantId: PLATFORM_TENANT, actor: "admin:bruno" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

/** A custom Worker is only data: this is the whole definition of one, built from tools and models that already exist. */
export const customWorker = (over: Partial<WorkerInput> = {}): WorkerInput => ({
  id: "wd-demo", name: "Worker de ejemplo", specialty: "custom", summary: "Hace una tarea concreta para la empresa.", version: "1.0.0",
  tools: ["task.create"], dataClearance: "business",
  memory: { maxEntries: 20, maxChars: 2_000, allowPersonal: false, durable: false },
  routing: { needs: ["fast"], policy: {} },
  collaboration: { delegatesTo: [], acceptsFrom: [] },
  limits: { maxRunsPerDay: 50, maxStepsPerRun: 20, maxDelegationDepth: 0 },
  priority: "normal", costEstimate: { perRunMicros: 1_000 },
  ...over,
});

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;

export function demoKoeState(): { state: KoeState; errors: string[] } {
  const errors: string[] = [];
  let state = newKoeState(DEMO_ADMINS);
  const send = (event: KoeEvent) => {
    const result = reduceKoe(state, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const nova = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const vida = { tenantId: "tenant-vida", actor: "lucia" };
  const instance = (tenantId: string, definitionId: string) => state.instances.find((item) => item.tenantId === tenantId && item.definitionId === definitionId)?.id ?? "";
  const asWorker = (tenantId: string, workerId: string) => ({ tenantId, actor: workerActor(workerId) });
  const lastRun = () => state.runs.at(-1)?.id ?? "";

  for (const worker of ["coordinator", "sales", "followup", "reporter", "collections"]) send({ ...nova, at: day(1), type: "worker.enable", definitionId: worker });
  send({ ...vida, at: day(1), type: "worker.enable", definitionId: "reporter" });

  // a Level 2 authorization a person grants to the sales assistant: answer approved FAQs, five a day
  send({ ...nova, at: day(1), type: "authorization.grant", instanceId: instance("tenant-nova", "sales"), action: "faq.answer", maxPerDay: 5 });

  // ---- run 1: the coordinator splits a goal and hands pieces to specialists
  const coordinator = asWorker("tenant-nova", "coordinator");
  send({ ...nova, at: day(2), type: "run.start", instanceId: instance("tenant-nova", "coordinator"), goal: "Dar seguimiento a los prospectos calientes" });
  const plan = lastRun();
  send({ ...coordinator, at: day(2), type: "run.model", runId: plan });
  send({ ...coordinator, at: day(2), type: "memory.put", runId: plan, key: "prospecto", value: "Clínica Vida, score 82", sensitivity: "business" });
  send({ ...nova, at: day(2), type: "memory.promote", entryId: state.memory.at(-1)?.id ?? "" }); // the coordinator is allowed to keep memory
  send({ ...coordinator, at: day(2), type: "run.delegate", runId: plan, toWorker: "sales", goal: "Calificar al prospecto y preparar el mensaje", grant: ["contact.read", "lead.score", "message.draft"], contextKeys: ["prospecto"] });
  const salesRun = lastRun();
  const sales = asWorker("tenant-nova", "sales");
  send({ ...sales, at: day(2), type: "run.tool", runId: salesRun, tool: "contact.read", input: { contacto: "Clínica Vida" } });
  send({ ...sales, at: day(2), type: "run.tool", runId: salesRun, tool: "lead.score", input: { prospecto: "Clínica Vida" } });
  send({ ...sales, at: day(2), type: "run.model", runId: salesRun }); // it touched personal data, so the router must pick a model that does not train on it
  send({ ...sales, at: day(2), type: "run.tool", runId: salesRun, tool: "message.draft", input: { contacto: "Clínica Vida", tema: "Seguimiento de la cotización" } });
  send({ ...sales, at: day(2), type: "run.finish", runId: salesRun, outcome: "completed", result: "Score 82; mensaje preparado para Clínica Vida" }); // the result holds personal data: it does NOT travel back to the coordinator
  send({ ...coordinator, at: day(2), type: "run.delegate", runId: plan, toWorker: "reporter", goal: "Resumir el estado de los prospectos", grant: ["summary.prepare"], contextKeys: [] });
  const reportRun = lastRun();
  send({ ...asWorker("tenant-nova", "reporter"), at: day(2), type: "run.tool", runId: reportRun, tool: "summary.prepare", input: { tema: "Prospectos calientes" } });
  send({ ...asWorker("tenant-nova", "reporter"), at: day(2), type: "run.finish", runId: reportRun, outcome: "completed", result: "3 prospectos calientes; 1 sin próxima acción" });
  send({ ...coordinator, at: day(2), type: "run.finish", runId: plan, outcome: "completed", result: "Seguimiento coordinado: 1 mensaje preparado y 1 resumen" });

  // ---- run 2: a person starts the follow-up Worker; sending a message is Level 3, so it waits for a person (left pending)
  send({ ...nova, at: day(3), type: "run.start", instanceId: instance("tenant-nova", "followup"), goal: "Seguimiento de Clínica Vida" });
  const follow = lastRun();
  send({ ...asWorker("tenant-nova", "followup"), at: day(3), type: "run.tool", runId: follow, tool: "task.create", input: { titulo: "Llamar a Clínica Vida el jueves" } });
  send({ ...asWorker("tenant-nova", "followup"), at: day(3), type: "run.tool", runId: follow, tool: "followup.send", input: { contacto: "Clínica Vida", mensaje: "¿Pudo revisar la cotización?" } });

  // ---- run 3: collections prepares a payment link; money needs a second person (Pablo approves what Ana started)
  send({ ...nova, at: day(4), type: "run.start", instanceId: instance("tenant-nova", "collections"), goal: "Cobrar la factura de Hotel Mar" });
  const collect = lastRun();
  send({ ...asWorker("tenant-nova", "collections"), at: day(4), type: "run.tool", runId: collect, tool: "payment.createLink", input: { cliente: "Hotel Mar", monto: "900.00 USD" } });
  send({ ...pablo, at: day(4), type: "approval.decide", approvalId: state.approvals.at(-1)?.id ?? "", approve: true });
  send({ ...asWorker("tenant-nova", "collections"), at: day(4), type: "run.finish", runId: collect, outcome: "completed", result: "Enlace de cobro creado para Hotel Mar" });

  // ---- run 4: the sales assistant answers an FAQ on its own, because a person authorized exactly that
  send({ ...nova, at: day(5), type: "run.start", instanceId: instance("tenant-nova", "sales"), goal: "Responder una pregunta frecuente" });
  const faq = lastRun();
  send({ ...sales, at: day(5), type: "run.tool", runId: faq, tool: "faq.answer", input: { pregunta: "¿Cuál es el horario de atención?" } });
  send({ ...sales, at: day(5), type: "run.finish", runId: faq, outcome: "completed", result: "Respuesta aprobada enviada al panel" });

  // ---- a new Worker, as data only: NEX drafts it (Level 1), a person submits it, a second person approves it (left waiting)
  send({ tenantId: "tenant-nova", actor: "worker:nex", at: day(6), type: "worker.draft", input: customWorker({
    id: "reclamos", name: "Atención de reclamos", specialty: "support", summary: "Recibe un reclamo, lo resume y prepara la respuesta para una persona.",
    tools: ["contact.read", "message.draft", "task.create"], dataClearance: "personal", routing: { needs: ["fast"], policy: { deniedProviders: ["proveedor-c"] } },
    collaboration: { delegatesTo: [], acceptsFrom: ["coordinator"] },
  }) });
  send({ ...nova, at: day(6), type: "worker.submit", definitionId: "reclamos" });
  // ---- per-company installation: the tutor was installed and then switched off, and the sales assistant is limited by this company
  send({ ...nova, at: day(7), type: "worker.enable", definitionId: "tutor" });
  send({ ...nova, at: day(7), type: "instance.disable", instanceId: instance("tenant-nova", "tutor") });
  send({ ...nova, at: day(7), type: "instance.configure", instanceId: instance("tenant-nova", "sales"), maxRunsPerDay: 20, deniedProviders: ["proveedor-d"] });
  return { state, errors };
}

export const demoKoeOk = (): KoeState => {
  const { state, errors } = demoKoeState();
  if (errors.length) throw new Error(errors.join("; "));
  return state;
};
