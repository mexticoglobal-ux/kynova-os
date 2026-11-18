// First useful work (Sprint 66): from what the person needs this week, NEX recommends one priority and prepares one deliverable: a 7-day plan.
// Pure and deterministic: it reads what the app already knows (the company's prospects in the Pipeline, the person's role) and writes text. It
// asks for nothing else, calls no model and sends nothing. Three things are kept apart on screen and in the text:
//   - an EXAMPLE (not about their company's data), - a SAVED DRAFT (the person saved it, private to them), - an EXECUTED ACTION (none exists here: nothing is sent or booked).

import type { Lead } from "@/lib/contracts/pipeline";
import { NO_CONTACT_ACTION } from "@/lib/guided-chat";

export const NEEDS = ["followUp", "clients"] as const;
export type Need = (typeof NEEDS)[number];
export const NEED_LABEL: Record<Need, string> = { followUp: "Dar seguimiento a lo que ya tengo", clients: "Conseguir más clientes" };

/** Every saved plan starts with this, so the history can tell a saved draft from a (simulated) reply. */
export const DRAFT_MARK = "Borrador guardado · ";

export type FirstWorkContext = {
  /** no company connected: the prospects are the demonstration's fictitious ones */ demo: boolean;
  companyName: string | null;
  roleLabel: string;
  canWrite: boolean;
  /** the Pipeline's leads, most important first */ leads: readonly Lead[];
};

export type Recommendation = { need: Need; priority: string; why: string };
export type PlanItem = { when: string; task: string; note?: string };
export type Deliverable = {
  title: string;
  /** "company": built from the company's own prospects · "example": not about their data */ basis: "company" | "example";
  items: readonly PlanItem[];
  draft: { for: string; text: string } | null;
  /** what is not connected today, so nothing is executed */ missing: readonly string[];
};

const MISSING_SEND = "Enviar el mensaje: hoy no hay ningún canal de envío conectado (las Apps conectadas son una vista de prueba). Cuando exista uno, una persona deberá aprobar cada envío.";
const MISSING_CALENDAR = "Agendar la reunión: falta conectar un calendario.";
const MISSING_CHANNELS = "Publicar o atender redes sociales: no hay canales conectados; el único canal que existe es el chat web de prueba dentro de la app.";

const stageOpen = (lead: Lead) => lead.stage !== "won";
const reachable = (lead: Lead) => lead.contact !== null;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One priority and one reason, from the company's own prospects. No question needed. */
export function recommend(ctx: FirstWorkContext): Recommendation {
  const open = ctx.leads.filter(stageOpen);
  const pending = open.filter((lead) => lead.approval).length;
  const example = ctx.demo ? " (datos de ejemplo)" : "";
  if (pending > 0) {
    return {
      need: "followUp",
      priority: `Decidir ${plural(pending, "solicitud de reunión que NEX ya preparó", "solicitudes de reunión que NEX ya preparó")}${example}`,
      why: ctx.canWrite
        ? "Son prospectos que ya mostraron interés y cada día sin decidir enfría el contacto."
        : `Son prospectos que ya mostraron interés. Con su rol (${ctx.roleLabel}) puede revisarlas; las decide quien tenga permiso de edición.`,
    };
  }
  if (open.length > 0) {
    return {
      need: "followUp",
      priority: `Dar seguimiento a ${plural(open.length, "prospecto que ya llegó", "prospectos que ya llegaron")}${example}`,
      why: "Atender a quien ya llegó cuesta menos que conseguir prospectos nuevos.",
    };
  }
  return {
    need: "clients",
    priority: "Tener a quién atender: preparar la captación",
    why: "Todavía no hay prospectos de su empresa en el Pipeline. Conviene empezar por entender su negocio y probar el chat de captación.",
  };
}

function followUpPlan(ctx: FirstWorkContext): Deliverable | null {
  const open = ctx.leads.filter(stageOpen);
  const asked = open.filter((lead) => lead.approval).slice(0, 3);
  const others = open.filter((lead) => !lead.approval);
  const toFollow = others.filter(reachable).slice(0, 3);
  const unreachable = others.filter((lead) => !reachable(lead) && lead.grade !== "human").slice(0, 2);
  const items: PlanItem[] = [
    ...asked.map((lead): PlanItem => ({
      when: "Hoy",
      task: `Decidir la solicitud de reunión de ${lead.company}`,
      note: ctx.canWrite ? "En Ventas: aprobar o rechazar." : "Requiere permiso de edición: pídaselo a quien administra la empresa.",
    })),
    ...toFollow.map((lead): PlanItem => ({ when: "Esta semana", task: `${lead.company}: ${lead.nextAction}` })),
    ...unreachable.map((lead): PlanItem => ({ when: "Cuando vuelva", task: `${lead.company}: ${NO_CONTACT_ACTION}` })),
  ];
  if (items.length === 0) return null;
  const target = toFollow[0] ?? asked[0];
  const who = ctx.companyName ?? "nuestro equipo";
  return {
    title: "Plan de seguimiento de 7 días",
    basis: ctx.demo ? "example" : "company",
    items,
    draft: target && reachable(target)
      ? { for: target.company, text: `Hola ${target.contactName}, le escribo de parte de ${who}. Quedé atento a su consulta: ¿le parece si coordinamos una llamada breve esta semana? Dígame qué día y hora le convienen.` }
      : null,
    missing: [MISSING_SEND, MISSING_CALENDAR],
  };
}

function capturePlan(ctx: FirstWorkContext): Deliverable {
  const who = ctx.companyName ?? "mi empresa";
  return {
    title: "Plan de captación de 7 días",
    basis: "example",
    items: [
      { when: "Día 1", task: "Hacer el diagnóstico de su negocio con NEX", note: "Opcional y de unos 5 minutos: da una puntuación y los servicios que más conviene ofrecer." },
      { when: "Día 2", task: "Elegir el servicio que quiere ofrecer primero" },
      { when: "Día 3", task: "Probar el chat de captación con un caso ficticio", note: "Está en NEX › chat de captación. Allí sí se pide un contacto, porque es el chat de un visitante." },
      { when: "Día 4", task: "Revisar y ajustar el mensaje de presentación (borrador abajo)" },
      { when: "Día 5 a 7", task: "Revisar el Pipeline y el Dashboard para ver quién llegó" },
    ],
    draft: { for: "un prospecto nuevo", text: `Hola, le escribo de parte de ${who}. Me gustaría conocer qué es lo más urgente para su negocio hoy y ver si podemos ayudarle. ¿Tiene 15 minutos esta semana?` },
    missing: [MISSING_CHANNELS, MISSING_SEND],
  };
}

/** The deliverable for the need. Followup with nothing to follow up falls back to the capture plan (an example). */
export function buildDeliverable(need: Need, ctx: FirstWorkContext): Deliverable {
  return (need === "followUp" ? followUpPlan(ctx) : null) ?? capturePlan(ctx);
}

/** The plan as text, to keep as a draft. It says it is a draft, what it is based on, and that nothing was executed. */
export function planText(deliverable: Deliverable, recommendation: Recommendation): string {
  const lines = [
    `${DRAFT_MARK}${deliverable.title}`,
    deliverable.basis === "example" ? "Es un ejemplo: no se basa en los datos de su empresa." : "Se basa en los prospectos de su empresa.",
    `Prioridad: ${recommendation.priority}.`,
    `Por qué: ${recommendation.why}`,
    "",
    ...deliverable.items.map((item) => `• ${item.when}: ${item.task}${item.note ? ` (${item.note})` : ""}`),
    ...(deliverable.draft ? ["", `Borrador de mensaje para ${deliverable.draft.for} (no enviado):`, `“${deliverable.draft.text}”`] : []),
    "",
    "Acciones ejecutadas: ninguna. No se envió ningún mensaje ni se agendó nada.",
    ...deliverable.missing.map((item) => `Falta: ${item}`),
  ];
  return lines.join("\n");
}
