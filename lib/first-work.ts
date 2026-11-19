// First useful work (Sprint 66): NEX recommends one priority and prepares a draft the person can review right away.
// Pure and deterministic: it reads what the app already knows (the company's prospects in the Pipeline, the person's role) plus up to two short
// sentences the person may type, and writes text by rules. It calls no model and sends nothing. What it does not know it leaves as "[completar: …]";
// it never makes up what the company offers. Three things are kept apart on screen and in the text:
//   - an EXAMPLE (demonstration data), - a SAVED DRAFT (the person saved it, private to them), - an EXECUTED ACTION (none exists here).

import type { Lead } from "@/lib/contracts/pipeline";
import { NO_CONTACT_ACTION } from "@/lib/guided-chat";

export const NEEDS = ["clients", "followUp"] as const;
export type Need = (typeof NEEDS)[number];
export const NEED_LABEL: Record<Need, string> = { clients: "Conseguir más clientes", followUp: "Dar seguimiento a lo que ya tengo" };

/** Every saved draft starts with this, so the history can tell a saved draft from a (simulated) reply. */
export const DRAFT_MARK = "Borrador guardado · ";

/** What the history shows for each kind of saved draft. */
export const HISTORY_TITLE: Record<Need, string> = { clients: "Captación: mensaje y presentación", followUp: "Seguimiento: prospectos" };
/** Titles drafts were saved with before the two kinds had their own (their type is read from the text when it can be). */
export const LEGACY_DRAFT_TITLES: readonly string[] = ["Plan de 7 días", "Borrador: primera prioridad"];

/** The history title of a saved draft, read from its first line ("Borrador guardado · <title>"); null when it is not one of ours or its type cannot be told. */
export function historyTitleOf(text: string): string | null {
  if (!text.startsWith(DRAFT_MARK)) return null;
  const first = (text.split("\n")[0] ?? "").slice(DRAFT_MARK.length).toLowerCase();
  if (first.includes("seguimiento")) return HISTORY_TITLE.followUp;
  if (first.includes("captación") || first.includes("mensaje y presentación")) return HISTORY_TITLE.clients;
  return null;
}

export type FirstWorkContext = {
  /** no company connected: the prospects are the demonstration's fictitious ones */ demo: boolean;
  companyName: string | null;
  roleLabel: string;
  canWrite: boolean;
  /** the Pipeline's leads, most important first */ leads: readonly Lead[];
  /** what the person typed (optional, one sentence each); empty = not provided */ offer?: string;
  audience?: string;
};

export type Recommendation = { need: Need; priority: string; why: string };
export type ListItem = { label: string; task: string; note?: string };
export type Piece = { label: string; text: string };
export type Deliverable = {
  /** which kind of draft it is (a follow-up with nothing to follow up is a capture draft) */ kind: Need;
  title: string;
  /** "company": built with the company's data · "example": demonstration data */ basis: "company" | "example";
  items: readonly ListItem[];
  pieces: readonly Piece[];
  /** what the person has not told us yet and the draft leaves as [completar: …] */ needsContext: readonly string[];
};

/** Nothing is executed today; whether NEX can send, publish or book later depends on what gets connected and configured. */
export const EXECUTION_NOTE = "Hoy no se ejecutan envíos, publicaciones ni reuniones. Que NEX pueda hacerlos dependerá de los canales que se conecten y de los permisos que se configuren.";

const open = (ctx: FirstWorkContext) => ctx.leads.filter((lead) => lead.stage !== "won");
const reachable = (lead: Lead) => lead.contact !== null;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const clean = (value: string | undefined) => (value ?? "").trim().replace(/[.\s]+$/, "");

/** Which goal to suggest, from what the Pipeline holds. The person can still choose the other one. */
export function recommend(ctx: FirstWorkContext): Recommendation {
  const need: Need = open(ctx).length > 0 ? "followUp" : "clients";
  return { need, ...priorityFor(need, ctx) };
}

/** A goal chosen to follow up with nothing to follow up gets the capture draft instead (and says why). */
export const effectiveNeed = (need: Need, ctx: FirstWorkContext): Need => (need === "followUp" && open(ctx).length === 0 ? "clients" : need);

/** The priority and its reason for a CHOSEN goal. It never contradicts the Pipeline: each sentence is about the goal or about what is really there. */
export function priorityFor(need: Need, ctx: FirstWorkContext): { priority: string; why: string } {
  const leads = open(ctx);
  const pending = leads.filter((lead) => lead.approval).length;
  const example = ctx.demo ? " (datos de ejemplo)" : "";
  if (need === "followUp" && leads.length === 0) {
    return { priority: "Todavía no hay prospectos abiertos que atender", why: "Mientras tanto, NEX preparó la propuesta para conseguir clientes." };
  }
  if (need === "followUp") {
    return {
      priority: pending > 0
        ? `Decidir ${plural(pending, "solicitud de reunión que NEX ya preparó", "solicitudes de reunión que NEX ya preparó")}${example}`
        : `Dar seguimiento a ${plural(leads.length, "prospecto que ya llegó", "prospectos que ya llegaron")}${example}`,
      why: pending > 0
        ? (ctx.canWrite ? "Son prospectos que ya mostraron interés y cada día sin decidir enfría el contacto." : `Son prospectos que ya mostraron interés. Con su rol (${ctx.roleLabel}) puede revisarlas; las decide quien tenga permiso de edición.`)
        : "Atender a quien ya llegó cuesta menos que conseguir prospectos nuevos.",
    };
  }
  return {
    priority: "Conseguir más clientes: un mensaje y una presentación claros",
    why: leads.length > 0
      ? `Ya tiene ${plural(leads.length, "prospecto abierto", "prospectos abiertos")} en el Pipeline${example}; esta propuesta es para atraer más sin descuidar a los actuales.`
      : "Todavía no hay prospectos abiertos en el Pipeline: lo primero es poder explicar qué ofrece y a quién.",
  };
}

function capturePieces(ctx: FirstWorkContext): { pieces: Piece[]; needsContext: string[] } {
  const company = ctx.companyName ?? "[completar: nombre de su empresa]";
  const offer = clean(ctx.offer);
  const audience = clean(ctx.audience);
  const needsContext = [...(offer ? [] : ["qué ofrece su empresa"]), ...(audience ? [] : ["a quién se dirige"])];
  // The person's own words, labelled and unchanged: they are never bent into a sentence, and nothing about benefits or results is added.
  const offerLine = [offer ? `Lo que ofrecemos: ${offer}.` : "[completar: qué ofrece su empresa]", audience ? `Trabajamos con: ${audience}.` : "[completar: a quién se dirige]"].join(" ");
  return {
    needsContext,
    pieces: [
      { label: "Mensaje propuesto", text: `Hola, le escribo de parte de ${company}. ${offerLine} ¿Le parece si conversamos unos 15 minutos esta semana para ver si podemos ayudarle?` },
      {
        label: "Pieza de presentación (borrador)",
        text: [
          `${company}`,
          `Qué hacemos: ${offer || "[completar: qué ofrece su empresa]"}`,
          `A quién ayudamos: ${audience || "[completar: a quién se dirige]"}`,
          "Cómo seguimos: una conversación breve para entender qué necesita y ver si podemos ayudarle.",
        ].join("\n"),
      },
    ],
  };
}

function followUpDeliverable(ctx: FirstWorkContext): Deliverable {
  const leads = open(ctx);
  const asked = leads.filter((lead) => lead.approval).slice(0, 3);
  const others = leads.filter((lead) => !lead.approval);
  const toFollow = others.filter(reachable).slice(0, 3);
  const unreachable = others.filter((lead) => !reachable(lead) && lead.grade !== "human").slice(0, 2);
  const items: ListItem[] = [
    ...asked.map((lead): ListItem => ({ label: "Decidir", task: `La solicitud de reunión de ${lead.company}`, note: ctx.canWrite ? "En Ventas: aprobar o rechazar." : "Requiere permiso de edición: pídaselo a quien administra la empresa." })),
    ...toFollow.map((lead): ListItem => ({ label: "Dar seguimiento", task: `${lead.company}: ${lead.nextAction}` })),
    ...unreachable.map((lead): ListItem => ({ label: "En espera", task: `${lead.company}: ${NO_CONTACT_ACTION}` })),
  ];
  const target = toFollow[0] ?? asked.find(reachable);
  const who = ctx.companyName ?? "nuestro equipo";
  return {
    kind: "followUp",
    title: "Seguimiento preparado",
    basis: ctx.demo ? "example" : "company",
    items,
    pieces: target
      ? [{ label: `Mensaje propuesto para ${target.company}`, text: `Hola ${target.contactName}, le escribo de parte de ${who}. Quedé atento a su consulta: ¿le parece si coordinamos una llamada breve esta semana? Dígame qué día y hora le convienen.` }]
      : [],
    needsContext: [],
  };
}

/** The draft for the chosen goal. */
export function buildDeliverable(need: Need, ctx: FirstWorkContext): Deliverable {
  if (effectiveNeed(need, ctx) === "followUp") return followUpDeliverable(ctx);
  const { pieces, needsContext } = capturePieces(ctx);
  return { kind: "clients", title: "Propuesta de mensaje y presentación", basis: ctx.demo ? "example" : "company", items: [], pieces, needsContext };
}

/** The draft as text, to keep: it says it is a draft, what it is based on, what is missing, and that nothing was executed. */
export function planText(deliverable: Deliverable, advice: { priority: string; why: string }): string {
  return [
    `${DRAFT_MARK}${deliverable.title}`,
    deliverable.basis === "example" ? "Datos de ejemplo (modo demostración)." : "Se basa en datos de su empresa y en lo que usted escribió.",
    `Prioridad: ${advice.priority}.`,
    `Por qué: ${advice.why}`,
    ...(deliverable.items.length > 0 ? ["", ...deliverable.items.map((item) => `• ${item.label}: ${item.task}${item.note ? ` (${item.note})` : ""}`)] : []),
    ...deliverable.pieces.flatMap((piece) => ["", `${piece.label}:`, piece.text]),
    ...(deliverable.needsContext.length > 0 ? ["", `Falta completar: ${deliverable.needsContext.join("; ")}.`] : []),
    "",
    "Acciones ejecutadas: ninguna.",
    EXECUTION_NOTE,
  ].join("\n");
}
