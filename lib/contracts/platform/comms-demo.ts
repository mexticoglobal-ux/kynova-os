// Sample data for the local simulation of the Communications Hub. Fictional companies and people. Built by applying events through the
// same reducer a real adapter will use, so loading it also proves the rules hold together. No message here was ever sent to anyone.

import { DEMO_NOW, demoCrmOk } from "./crm-demo";
import type { CrmState } from "./crm-center";
import { DEFAULT_KOE_ENV, newCommsState, reduceComms, type CommsEnv, type CommsEvent, type CommsState } from "./comms-center";

export { DEMO_NOW };
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

/** Minutes before the simulation's "now": the demo is written relative to it, so waiting times always read the same. */
const ago = (minutes: number) => new Date(Date.parse(DEMO_NOW) - minutes * 60_000).toISOString();
const MIN = { hour: 60, day: 1_440 };

export function demoCommsEnv(crm: CrmState = demoCrmOk()): CommsEnv {
  return { ...DEFAULT_KOE_ENV, refs: { leads: crm.leads.map((item) => ({ id: item.id, tenantId: item.tenantId })), customers: crm.customers.map((item) => ({ id: item.id, tenantId: item.tenantId })) }, crm };
}

export type CommsSource = { crm: CrmState; env: CommsEnv; state: CommsState; errors: string[] };

export function demoCommsSource(): CommsSource {
  const crm = demoCrmOk();
  const env = demoCommsEnv(crm);
  const errors: string[] = [];
  let state = newCommsState();
  const send = (event: CommsEvent) => {
    const result = reduceComms(state, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const ana = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const nex = { tenantId: "tenant-nova", actor: "worker:nex" };
  const system = { tenantId: "tenant-nova", actor: "system" };
  const lucia = { tenantId: "tenant-vida", actor: "lucia" };
  const vidaSystem = { tenantId: "tenant-vida", actor: "system" };
  const lead = (name: string) => crm.leads.find((item) => item.name === name && item.tenantId === "tenant-nova")?.id ?? "";
  const customer = (company: string) => crm.customers.find((item) => item.company === company && item.tenantId === "tenant-nova")?.id ?? "";
  const conv = (subject: string, tenantId = "tenant-nova") => state.conversations.find((item) => item.subject === subject && item.tenantId === tenantId)?.id ?? "";

  send({ ...ana, at: ago(3 * MIN.day), type: "authorization.grant", maxPerDay: 3 }); // Level 2: NEX may reassign a conversation inside this limit

  // 1. an email from a prospect asking for the final quote: a sale, two hours waiting; the CRM knows the deal
  send({ ...system, at: ago(5 * MIN.day), type: "conversation.open", input: { channel: "email", subject: "Propuesta de automatización: cotización final", contact: { name: "Marta Solís", handle: "marta@dentalsol.test" }, company: "Clínica Dental Sol", text: "Gracias por la propuesta, la estamos revisando con mi socio." } });
  send({ ...ana, at: ago(5 * MIN.day - 90), type: "message.record", conversationId: conv("Propuesta de automatización: cotización final"), text: "Con gusto, quedamos atentos a sus comentarios." });
  send({ ...ana, at: ago(4 * MIN.day), type: "conversation.link", conversationId: conv("Propuesta de automatización: cotización final"), leadId: lead("Marta Solís") });
  send({ ...ana, at: ago(4 * MIN.day), type: "conversation.assign", conversationId: conv("Propuesta de automatización: cotización final"), assignee: "ana" });
  send({ ...system, at: ago(4 * MIN.day - 20), type: "timeline.record", conversationId: conv("Propuesta de automatización: cotización final"), kind: "automation", text: "La automatización «Prospecto caliente» preparó un borrador de correo.", ref: "au_0001" });
  send({ ...system, at: ago(4 * MIN.day - 30), type: "timeline.record", conversationId: conv("Propuesta de automatización: cotización final"), kind: "worker", text: "El Worker Asistente comercial calificó al prospecto.", ref: "sales" });
  send({ ...system, at: ago(4 * MIN.day - 40), type: "timeline.record", conversationId: conv("Propuesta de automatización: cotización final"), kind: "audit", text: "Business Audit: ajuste alto; recomienda automatizaciones y CRM." });
  send({ ...system, at: ago(130), type: "message.receive", conversationId: conv("Propuesta de automatización: cotización final"), text: "Hola, ¿pueden enviarme la cotización final con los precios? Quisiera contratar esta semana." });

  // 2. WhatsApp from a customer: the site fails and it is urgent; nobody attends it yet
  send({ ...system, at: ago(6 * MIN.hour), type: "conversation.open", input: { channel: "whatsapp", subject: "Soporte del sitio web", contact: { name: "Elena Vargas", handle: "88887777" }, company: "Studio Verde", text: "El sitio no funciona, da error al subir fotos. Es urgente, ya mismo por favor." } });
  send({ ...ana, at: ago(5 * MIN.hour), type: "conversation.link", conversationId: conv("Soporte del sitio web"), customerId: customer("Studio Verde") });

  // 3. Messenger: a stranger asks the price of the annual plan, twenty minutes ago
  send({ ...system, at: ago(20), type: "conversation.open", input: { channel: "messenger", subject: "Consulta de precios", contact: { name: "Carlos Mena", handle: "carlos.mena" }, company: "", text: "Hola, ¿cuánto cuesta el plan anual?" } });

  // 4. Instagram: a thank-you; only a person can close it
  send({ ...system, at: ago(30 * MIN.hour), type: "conversation.open", input: { channel: "instagram", subject: "Mensaje directo de @cafe.aurora", contact: { name: "Café Aurora", handle: "@cafe.aurora" }, company: "Café Aurora", text: "Gracias por la propuesta, excelente atención. ¡Muy buena!" } });
  send({ ...pablo, at: ago(29 * MIN.hour), type: "conversation.assign", conversationId: conv("Mensaje directo de @cafe.aurora"), assignee: "pablo" });

  // 5. web chat: a billing problem, twelve minutes ago
  send({ ...system, at: ago(12), type: "conversation.open", input: { channel: "webchat", subject: "Chat con el visitante 213", contact: { name: "Visitante 213", handle: "visitor-213" }, company: "", text: "Necesito ayuda con mi factura, me cobraron dos veces." } });

  // 6. web form: an angry prospect who wants to cancel, waiting for three days
  send({ ...system, at: ago(3 * MIN.day + 60), type: "conversation.open", input: { channel: "webform", subject: "Formulario de contacto de Luis Prado", contact: { name: "Luis Prado", handle: "luis@aurora.test" }, company: "Café Aurora", text: "Quisiera cancelar mi proceso. Estoy molesto, nadie me respondió. Es urgente." } });
  send({ ...ana, at: ago(3 * MIN.day), type: "conversation.link", conversationId: conv("Formulario de contacto de Luis Prado"), leadId: lead("Luis Prado") });

  // 7. a pending email: we answered and are waiting for the hotel
  send({ ...system, at: ago(6 * MIN.day), type: "conversation.open", input: { channel: "email", subject: "Re: Propuesta de 9 000 USD", contact: { name: "Carla Mena", handle: "carla@hotelmar.test" }, company: "Hotel Mar", text: "Gracias, revisaremos la propuesta con el equipo y le avisamos." } });
  send({ ...ana, at: ago(6 * MIN.day - 120), type: "message.record", conversationId: conv("Re: Propuesta de 9 000 USD"), text: "Perfecto, quedamos atentos." });
  send({ ...ana, at: ago(6 * MIN.day - 130), type: "conversation.link", conversationId: conv("Re: Propuesta de 9 000 USD"), leadId: lead("Carla Mena") });
  send({ ...ana, at: ago(6 * MIN.day - 140), type: "status.set", conversationId: conv("Re: Propuesta de 9 000 USD"), to: "pending" });

  // 8. a customer asking for another service: a sale; assigned and waiting two days
  send({ ...system, at: ago(2 * MIN.day), type: "conversation.open", input: { channel: "whatsapp", subject: "Servicio de SEO para Boutique Luna", contact: { name: "Diego Luna", handle: "88886666" }, company: "Boutique Luna", text: "¿Podemos contratar también el servicio de SEO? Quisiera una cotización." } });
  send({ ...pablo, at: ago(2 * MIN.day - 30), type: "conversation.link", conversationId: conv("Servicio de SEO para Boutique Luna"), customerId: customer("Boutique Luna") });
  send({ ...pablo, at: ago(2 * MIN.day - 40), type: "conversation.assign", conversationId: conv("Servicio de SEO para Boutique Luna"), assignee: "pablo" });

  // 9. a resolved one and an archived one: closed by people, never deleted
  send({ ...system, at: ago(8 * MIN.day), type: "conversation.open", input: { channel: "webchat", subject: "Horario de atención", contact: { name: "Visitante 150", handle: "visitor-150" }, company: "", text: "¿Cuál es su horario de atención?" } });
  send({ ...ana, at: ago(8 * MIN.day - 20), type: "message.record", conversationId: conv("Horario de atención"), text: "De lunes a viernes de 8 a 5." });
  send({ ...ana, at: ago(8 * MIN.day - 30), type: "status.set", conversationId: conv("Horario de atención"), to: "resolved" });
  send({ ...system, at: ago(20 * MIN.day), type: "conversation.open", input: { channel: "email", subject: "Consulta antigua de proveedores", contact: { name: "Proveedor Sur", handle: "ventas@proveedor.test" }, company: "Proveedor Sur", text: "Les enviamos nuestro catálogo actualizado." } });
  send({ ...ana, at: ago(19 * MIN.day), type: "status.set", conversationId: conv("Consulta antigua de proveedores"), to: "archived" });

  // internal notes: only the team sees them
  send({ ...pablo, at: ago(4 * MIN.hour), type: "note.add", conversationId: conv("Soporte del sitio web"), text: "Revisar con el equipo técnico: el error de subida de fotos ya se vio ayer en otro cliente." });
  send({ ...ana, at: ago(100), type: "note.add", conversationId: conv("Propuesta de automatización: cotización final"), text: "Marta quiere cerrar esta semana: ofrecer el descuento del 5 % si firma hoy." });

  // NEX: classifies, tags, prepares drafts and, inside the authorization, reassigns. It never sends or closes anything.
  for (const subject of ["Propuesta de automatización: cotización final", "Soporte del sitio web", "Consulta de precios", "Chat con el visitante 213", "Formulario de contacto de Luis Prado", "Servicio de SEO para Boutique Luna"]) send({ ...nex, at: ago(10), type: "conversation.classify", conversationId: conv(subject) });
  for (const subject of ["Propuesta de automatización: cotización final", "Soporte del sitio web", "Consulta de precios", "Chat con el visitante 213"]) send({ ...nex, at: ago(9), type: "draft.create", conversationId: conv(subject) });
  send({ ...nex, at: ago(8), type: "tag.add", conversationId: conv("Propuesta de automatización: cotización final"), tag: "seguimiento" });
  send({ ...nex, at: ago(7), type: "conversation.assign", conversationId: conv("Consulta de precios"), assignee: "pablo" });
  send({ ...ana, at: ago(6), type: "draft.ready", draftId: state.drafts.find((item) => item.conversationId === conv("Propuesta de automatización: cotización final"))?.id ?? "" });

  // a second company: its own conversations, never mixed with Nova's
  send({ ...vidaSystem, at: ago(45), type: "conversation.open", input: { channel: "whatsapp", subject: "Cita de la Dra. Pineda", contact: { name: "Rosa Pineda", handle: "88885555" }, company: "Laboratorio Norte", text: "Hola, ¿pueden confirmarme la cita de mañana? Gracias." } });
  send({ ...vidaSystem, at: ago(2 * MIN.day), type: "conversation.open", input: { channel: "email", subject: "Resultados de laboratorio", contact: { name: "Tomás Ruiz", handle: "tomas@optica.test" }, company: "Óptica Visión", text: "Tengo un problema, no puedo abrir el archivo con mis resultados." } });
  send({ ...lucia, at: ago(2 * MIN.day - 10), type: "conversation.assign", conversationId: conv("Resultados de laboratorio", "tenant-vida"), assignee: "lucia" });
  return { crm, env, state, errors };
}

export const demoCommsOk = (): CommsSource => {
  const source = demoCommsSource();
  if (source.errors.length) throw new Error(source.errors.join("; "));
  return source;
};
