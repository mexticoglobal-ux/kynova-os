// Sample data for the local simulation of the CRM. Fictional companies and people. Built by applying events through the same reducer
// a real adapter will use, so loading it also proves the rules hold together. Nothing is a real message, call or sale.

import type { AssessmentAnswers } from "../assessment";
import { newCrmState, reduceCrm, type CrmEvent, type CrmState, type LeadInput } from "./crm-center";

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo", tenantId: "tenant-nova", actor: "pablo" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía", tenantId: "tenant-vida", actor: "lucia" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

/** "Today" of the simulation: every time-dependent figure (days in stage, days without contact) is measured from here. */
export const DEMO_NOW = "2026-11-02T12:00:00.000Z";
const at = (month: number, day: number, hour = 10) => `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const oct = (day: number, hour = 10) => at(10, day, hour);
const usd = (amount: number) => amount * 1_000_000;

export const HOT_ANSWERS: AssessmentAnswers = { sector: "professionalServices", teamSize: "medium", channel: "web", crm: "none", problem: "followUp", goal: "moreSales" };
export const COLD_ANSWERS: AssessmentAnswers = { sector: "other", teamSize: "solo", channel: "inPerson", crm: "fullCrm", problem: "cash", goal: "understandData" };

const lead = (name: string, company: string, value: number, fit: number, owner: string, extra: Partial<LeadInput> = {}): LeadInput => ({ name, company, source: "Formulario web", estimatedValueMicros: usd(value), fit, owner, ...extra });

export function demoCrmState(): { state: CrmState; errors: string[] } {
  const errors: string[] = [];
  let state = newCrmState();
  const send = (event: CrmEvent) => {
    const result = reduceCrm(state, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const ana = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const nex = { tenantId: "tenant-nova", actor: "worker:nex" };
  const system = { tenantId: "tenant-nova", actor: "system" };
  const lucia = { tenantId: "tenant-vida", actor: "lucia" };
  const vidaSystem = { tenantId: "tenant-vida", actor: "system" };
  const id = (name: string, tenantId = "tenant-nova") => state.leads.find((item) => item.name === name && item.tenantId === tenantId)?.id ?? "";
  const customerId = (company: string) => state.customers.find((item) => item.company === company)?.id ?? "";
  const subject = (name: string, tenantId = "tenant-nova") => ({ kind: "lead" as const, id: id(name, tenantId) });

  send({ ...ana, at: oct(1), type: "authorization.grant", maxPerDay: 3 }); // Level 2: NEX may move a stage one step, inside this limit

  // 1. a hot deal: in negotiation, contacted three days ago
  send({ ...ana, at: oct(6), type: "lead.create", input: lead("Marta Solís", "Clínica Dental Sol", 4_800, 82, "ana", { email: "marta@dentalsol.test", phone: "88881234" }) });
  send({ ...system, at: oct(6, 11), type: "audit.record", leadId: id("Marta Solís"), answers: HOT_ANSWERS });
  send({ ...ana, at: oct(7), type: "interaction.record", subject: subject("Marta Solís"), kind: "email", direction: "out", summary: "Primer correo con la presentación de servicios." });
  send({ ...ana, at: oct(8), type: "interaction.record", subject: subject("Marta Solís"), kind: "whatsapp", direction: "in", summary: "Marta responde: le interesa automatizar el seguimiento de citas." });
  send({ ...ana, at: oct(8, 12), type: "stage.move", leadId: id("Marta Solís"), to: "qualified" });
  send({ ...ana, at: oct(12), type: "interaction.record", subject: subject("Marta Solís"), kind: "call", direction: "out", summary: "Llamada de 25 minutos: dolor principal, el seguimiento." });
  send({ ...ana, at: oct(12, 15), type: "stage.move", leadId: id("Marta Solís"), to: "meeting" });
  send({ ...ana, at: oct(18), type: "interaction.record", subject: subject("Marta Solís"), kind: "email", direction: "out", summary: "Se envió la propuesta de automatización." });
  send({ ...ana, at: oct(18, 12), type: "stage.move", leadId: id("Marta Solís"), to: "proposal" });
  send({ ...ana, at: oct(24), type: "interaction.record", subject: subject("Marta Solís"), kind: "call", direction: "in", summary: "Marta llama a negociar el alcance." });
  send({ ...ana, at: oct(24, 12), type: "stage.move", leadId: id("Marta Solís"), to: "negotiation" });
  send({ ...ana, at: oct(30), type: "interaction.record", subject: subject("Marta Solís"), kind: "whatsapp", direction: "in", summary: "Marta confirma que revisará con su socio." });
  send({ ...system, at: oct(26), type: "timeline.record", subject: subject("Marta Solís"), kind: "automation", summary: "La automatización «Prospecto caliente» preparó un borrador de correo.", ref: "au_0001" });
  send({ ...system, at: oct(26, 9), type: "timeline.record", subject: subject("Marta Solís"), kind: "worker", summary: "El Worker Asistente comercial calificó al prospecto.", ref: "sales" });

  // 2. a cooling deal: qualified, nobody has written in twelve days
  send({ ...pablo, at: oct(14), type: "lead.create", input: lead("Luis Prado", "Café Aurora", 1_500, 55, "pablo", { email: "luis@aurora.test", source: "Referido" }) });
  send({ ...pablo, at: oct(15), type: "interaction.record", subject: subject("Luis Prado"), kind: "call", direction: "out", summary: "Primera llamada: tiene dudas con el precio." });
  send({ ...pablo, at: oct(16), type: "stage.move", leadId: id("Luis Prado"), to: "qualified" });
  send({ ...pablo, at: oct(21), type: "interaction.record", subject: subject("Luis Prado"), kind: "email", direction: "out", summary: "Se le envió el detalle de precios." });

  // 3. a big proposal waiting for an answer
  send({ ...ana, at: oct(10), type: "lead.create", input: lead("Carla Mena", "Hotel Mar", 9_000, 70, "ana", { email: "carla@hotelmar.test", phone: "88885678" }) });
  send({ ...system, at: oct(10, 11), type: "audit.record", leadId: id("Carla Mena"), answers: HOT_ANSWERS });
  send({ ...ana, at: oct(11), type: "interaction.record", subject: subject("Carla Mena"), kind: "call", direction: "out", summary: "Presentación de servicios por teléfono." });
  send({ ...ana, at: oct(12), type: "stage.move", leadId: id("Carla Mena"), to: "qualified" });
  send({ ...ana, at: oct(16), type: "stage.move", leadId: id("Carla Mena"), to: "meeting" });
  send({ ...ana, at: oct(22), type: "stage.move", leadId: id("Carla Mena"), to: "proposal" });
  send({ ...ana, at: oct(26), type: "interaction.record", subject: subject("Carla Mena"), kind: "email", direction: "out", summary: "Se envió la propuesta de 9 000 USD." });

  // 4. a brand-new prospect nobody has contacted
  send({ ...nex, at: oct(30), type: "lead.create", input: lead("Pedro Gómez", "Inmobiliaria Lomas", 3_200, 48, "", { source: "Formulario web" }) });
  send({ ...system, at: oct(30, 11), type: "audit.record", leadId: id("Pedro Gómez"), answers: COLD_ANSWERS });

  // 5. a prospect with a meeting coming up; NEX moves it one step, inside the authorization KOE's rules allow
  send({ ...pablo, at: oct(25), type: "lead.create", input: lead("Sofía Rey", "Taller Rápido", 2_000, 78, "pablo", { phone: "88889999" }) });
  send({ ...system, at: oct(25, 11), type: "audit.record", leadId: id("Sofía Rey"), answers: HOT_ANSWERS });
  send({ ...pablo, at: oct(27), type: "interaction.record", subject: subject("Sofía Rey"), kind: "whatsapp", direction: "in", summary: "Sofía pide una reunión para ver precios." });
  send({ ...nex, at: oct(28), type: "stage.move", leadId: id("Sofía Rey"), to: "qualified", note: "Puntaje alto y contacto reciente" });
  send({ ...pablo, at: oct(31), type: "meeting.schedule", leadId: id("Sofía Rey"), scheduledFor: at(11, 4, 15), title: "Reunión de diagnóstico con Taller Rápido" });

  // 6. two won deals that became customers, with what the other modules report about them
  for (const [name, company, value, fit, owner] of [["Elena Vargas", "Studio Verde", 6_000, 85, "ana"], ["Diego Luna", "Boutique Luna", 2_400, 75, "pablo"]] as const) {
    const who = owner === "ana" ? ana : pablo;
    send({ ...who, at: oct(2), type: "lead.create", input: lead(name, company, value, fit, owner, { email: `${name.split(" ")[0].toLowerCase()}@${company.split(" ")[0].toLowerCase()}.test` }) });
    send({ ...who, at: oct(3), type: "interaction.record", subject: subject(name), kind: "call", direction: "out", summary: "Llamada inicial." });
    for (const [stage, day] of [["qualified", 4], ["meeting", 6], ["proposal", 9], ["negotiation", 12]] as const) send({ ...who, at: oct(day), type: "stage.move", leadId: id(name), to: stage });
    send({ ...who, at: oct(16), type: "interaction.record", subject: subject(name), kind: "email", direction: "in", summary: "Aceptan la propuesta." });
    send({ ...who, at: oct(16, 12), type: "stage.move", leadId: id(name), to: "won", note: "Firmado" });
    send({ ...who, at: oct(17), type: "customer.convert", leadId: id(name) });
  }
  const verde = customerId("Studio Verde");
  const luna = customerId("Boutique Luna");
  send({ ...ana, at: oct(18), type: "contact.add", customerId: verde, name: "Raúl Vargas", role: "Finanzas", email: "raul@studio.test" });
  for (const [customer, kind, ref, label, amount] of [
    [verde, "product", "web", "Sitio web", undefined], [verde, "product", "seo", "SEO mensual", undefined], [verde, "academy", "course-ventas", "Curso: Ventas para clínicas (60 %)", undefined],
    [verde, "marketplace", "agent-1", "Compró el agente «Respuestas rápidas»", undefined], [verde, "automation", "au_0002", "Automatización: Bienvenida al cliente nuevo", undefined], [verde, "worker", "sales", "Worker: Asistente comercial", undefined],
    [verde, "payment", "pay-1", "Pago de implementación", usd(3_000)], [verde, "payment", "pay-2", "Mensualidad de octubre", usd(500)], [verde, "referral", "ref-1", "Refirió a Boutique Luna", undefined],
    [luna, "product", "web", "Sitio web", undefined], [luna, "payment", "pay-3", "Pago de implementación", usd(1_200)],
  ] as const) send({ ...system, at: oct(20), type: "customer.link", customerId: customer, kind, ref, label, ...(amount !== undefined ? { amountMicros: amount } : {}) });
  send({ ...system, at: oct(22), type: "timeline.record", subject: { kind: "customer", id: verde }, kind: "automation", summary: "La automatización «Bienvenida al cliente nuevo» preparó un WhatsApp." });

  // 7. a lost deal
  send({ ...pablo, at: oct(5), type: "lead.create", input: lead("Iván Soto", "Ferretería Centro", 1_800, 42, "pablo") });
  send({ ...pablo, at: oct(6), type: "interaction.record", subject: subject("Iván Soto"), kind: "call", direction: "out", summary: "No tiene presupuesto este trimestre." });
  send({ ...pablo, at: oct(9), type: "stage.move", leadId: id("Iván Soto"), to: "lost", note: "Sin presupuesto este trimestre" });

  // NEX prepares tasks for the open deals: proposals only. A person accepts one and completes another.
  for (const name of ["Marta Solís", "Luis Prado", "Carla Mena", "Pedro Gómez", "Sofía Rey"]) send({ ...nex, at: at(11, 1, 9), type: "task.generate", leadId: id(name) });
  const taskOf = (name: string, kind: string) => state.tasks.find((item) => item.leadId === id(name) && item.kind === kind)?.id ?? "";
  send({ ...ana, at: at(11, 1, 10), type: "task.accept", taskId: taskOf("Marta Solís", "call") });
  send({ ...pablo, at: at(11, 1, 11), type: "task.accept", taskId: taskOf("Luis Prado", "call") });
  send({ ...pablo, at: at(11, 1, 12), type: "task.complete", taskId: taskOf("Luis Prado", "call"), note: "No contestó; se dejó un mensaje" });

  // a second company: its own prospects, never mixed with Nova's
  send({ ...lucia, at: oct(12), type: "lead.create", input: lead("Dra. Rosa Pineda", "Laboratorio Norte", 5_500, 72, "lucia", { source: "Referido" }) });
  send({ ...lucia, at: oct(13), type: "interaction.record", subject: subject("Dra. Rosa Pineda", "tenant-vida"), kind: "call", direction: "out", summary: "Presentación de servicios." });
  send({ ...lucia, at: oct(14), type: "stage.move", leadId: id("Dra. Rosa Pineda", "tenant-vida"), to: "qualified" });
  send({ ...vidaSystem, at: oct(14, 11), type: "audit.record", leadId: id("Dra. Rosa Pineda", "tenant-vida"), answers: HOT_ANSWERS });
  send({ ...lucia, at: oct(20), type: "lead.create", input: lead("Tomás Ruiz", "Óptica Visión", 1_200, 50, "lucia") });
  return { state, errors };
}

export const demoCrmOk = (): CrmState => {
  const { state, errors } = demoCrmState();
  if (errors.length) throw new Error(errors.join("; "));
  return state;
};
