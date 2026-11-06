import {
  AUDIT_DIMENSIONS,
  MATURITY_LEVELS,
  type AuditAnswers,
  type AuditBand,
  type AuditDimension,
  type Budget,
  type DecisionRole,
  type Infrastructure,
  type MaturityLevel,
  type Qualification,
  type Timeline,
} from "@/lib/contracts/audit";
import { qualifyLead, runAudit } from "@/lib/audit";
import { ANALYSIS_STEPS, DIMENSION_COPY, pick, type Treatment } from "@/lib/audit-copy";
import { buildSummary, scoreStatus, type AuditSummary } from "@/lib/audit-summary";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";

// Guided chat v1: the Business Audit inside a conversation. A deterministic state machine with closed choices and
// pre-approved copy: no model writes to the visitor. Everything lives in memory; nothing is sent or stored.

export const INTENTS = ["audit", "question", "client", "human"] as const;
export type Intent = (typeof INTENTS)[number];

export const CHALLENGES = ["moreClients", "sellMore", "saveTime", "organize", "unsure"] as const;
export type Challenge = (typeof CHALLENGES)[number];

export const CONTACT_METHODS = ["email", "whatsapp", "phone", "none"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export type Step =
  | "start"
  | "question"
  | "name"
  | "businessName"
  | "challenge"
  | "audit"
  | "qualBudget"
  | "qualTimeline"
  | "qualRole"
  | "contactMethod"
  | "contactValue"
  | "end";

export type ChatState = {
  step: Step;
  treatment: Treatment;
  intent?: Intent;
  auditIndex: number;
  answers: Partial<AuditAnswers>;
  name?: string;
  businessName?: string;
  challenge?: Challenge;
  question?: string;
  budget?: Budget;
  timeline?: Timeline;
  role?: DecisionRole;
  contactMethod?: ContactMethod;
  contact?: string;
};

export type Route = "hot" | "warm" | "cold" | "human";

export type Handoff = {
  route: Route;
  // Why a person should look at this, in the visitor's own words where possible.
  reasons: string[];
  contact: { name?: string; method: Exclude<ContactMethod, "none">; value: string } | null;
  business: { name?: string; challenge?: string };
  question?: string;
  audit?: { score: number; band: AuditBand; infrastructure: Infrastructure; topGaps: AuditDimension[]; answers: AuditAnswers };
  services: string[];
  qualification?: Qualification;
  nextStep: string;
};

export type Say =
  | { kind: "text"; text: string }
  | { kind: "reaction"; text: string }
  | { kind: "working"; text: string }
  | { kind: "result"; score: number; band: AuditBand; infrastructure: Infrastructure; status: string; summary: AuditSummary }
  | { kind: "handoff"; handoff: Handoff };

export type Choice = { id: string; label: string };
export type Prompt =
  | { kind: "choice"; options: Choice[] }
  | { kind: "text"; field: "question" | "name" | "businessName" | "contact"; label: string; maxLength: number; optional?: boolean; inputType: "text" | "email" | "tel" }
  | { kind: "end" };

const CHALLENGE_LABEL: Record<Challenge, string> = {
  moreClients: "Conseguir más clientes",
  sellMore: "Venderle más a los clientes que ya tengo",
  saveTime: "Ahorrar tiempo en tareas repetitivas",
  organize: "Organizar mejor el negocio",
  unsure: "Todavía no lo tengo claro",
};

const BUDGET_LABEL: Record<Budget, string> = {
  unknown: "Todavía no lo he definido",
  low: "Un presupuesto pequeño",
  medium: "Un presupuesto moderado",
  high: "Un presupuesto amplio",
};

const TIMELINE_LABEL: Record<Timeline, string> = {
  now: "Lo antes posible",
  soon: "En el próximo mes o dos",
  later: "Más adelante este año",
  exploring: "Solo estoy explorando",
};

const ROLE_LABEL: Record<DecisionRole, string> = {
  owner: "Yo tomo la decisión",
  influencer: "Participo en la decisión",
  none: "Estoy reuniendo información para otra persona",
};

const METHOD_LABEL: Record<ContactMethod, string> = {
  email: "Por correo electrónico",
  whatsapp: "Por WhatsApp",
  phone: "Por llamada telefónica",
  none: "Prefiero no dejar mi contacto",
};

const METHOD_VALUE: Record<Exclude<ContactMethod, "none">, string> = {
  email: "su correo electrónico",
  whatsapp: "su número de WhatsApp",
  phone: "su número de teléfono",
};

export function initialState(treatment: Treatment): ChatState {
  return { step: "start", treatment, auditIndex: 0, answers: {} };
}

export function greeting(pack: ClientPack, treatment: Treatment): Say[] {
  const t = (usted: string, tu: string) => pick(treatment, [usted, tu]);
  return [
    { kind: "text", text: `Hola, soy NEX, el asistente automatizado de ${pack.brand}.` },
    {
      kind: "text",
      text: t(
        "Puedo ayudarle a entender en qué punto está su negocio y qué le conviene hacer primero, y dejar su consulta lista para que el equipo le atienda con contexto.",
        "Puedo ayudarte a entender en qué punto está tu negocio y qué te conviene hacer primero, y dejar tu consulta lista para que el equipo te atienda con contexto.",
      ),
    },
    { kind: "text", text: "Soy un asistente automático, no una persona. En esta demostración no se guarda ni se envía nada." },
    { kind: "text", text: t("¿Qué le gustaría hacer?", "¿Qué te gustaría hacer?") },
  ];
}

export function promptFor(state: ChatState): Prompt {
  const t = (usted: string, tu: string) => pick(state.treatment, [usted, tu]);
  switch (state.step) {
    case "start":
      return {
        kind: "choice",
        options: [
          { id: "audit", label: t("Quiero un diagnóstico de mi negocio", "Quiero un diagnóstico de mi negocio") },
          { id: "question", label: "Tengo una pregunta" },
          { id: "client", label: "Ya soy cliente" },
          { id: "human", label: "Prefiero hablar con una persona" },
        ],
      };
    case "question":
      return { kind: "text", field: "question", label: t("Escriba su pregunta", "Escribe tu pregunta"), maxLength: 500, inputType: "text" };
    case "name":
      return { kind: "text", field: "name", label: t("Escriba su nombre", "Escribe tu nombre"), maxLength: 80, inputType: "text" };
    case "businessName":
      return { kind: "text", field: "businessName", label: t("Nombre de su negocio", "Nombre de tu negocio"), maxLength: 80, optional: true, inputType: "text" };
    case "challenge":
      return { kind: "choice", options: CHALLENGES.map((id) => ({ id, label: CHALLENGE_LABEL[id] })) };
    case "audit": {
      const dimension = AUDIT_DIMENSIONS[state.auditIndex];
      return { kind: "choice", options: MATURITY_LEVELS.map((level) => ({ id: level, label: DIMENSION_COPY[dimension].options[level] })) };
    }
    case "qualBudget":
      return { kind: "choice", options: (Object.keys(BUDGET_LABEL) as Budget[]).map((id) => ({ id, label: BUDGET_LABEL[id] })) };
    case "qualTimeline":
      return { kind: "choice", options: (Object.keys(TIMELINE_LABEL) as Timeline[]).map((id) => ({ id, label: TIMELINE_LABEL[id] })) };
    case "qualRole":
      return { kind: "choice", options: (Object.keys(ROLE_LABEL) as DecisionRole[]).map((id) => ({ id, label: ROLE_LABEL[id] })) };
    case "contactMethod":
      return { kind: "choice", options: CONTACT_METHODS.map((id) => ({ id, label: METHOD_LABEL[id] })) };
    case "contactValue": {
      const method = state.contactMethod as Exclude<ContactMethod, "none">;
      const label = t(`Escriba ${METHOD_VALUE[method]}`, `Escribe ${METHOD_VALUE[method].replace("su ", "tu ")}`);
      return { kind: "text", field: "contact", label, maxLength: 120, inputType: method === "email" ? "email" : "tel" };
    }
    case "end":
      return { kind: "end" };
  }
}

// Returns an error message for a free-text input, or null if it can be accepted.
export function validate(state: ChatState, input: string): string | null {
  const prompt = promptFor(state);
  if (prompt.kind !== "text") return null;
  const value = input.trim();
  if (value === "") return prompt.optional ? null : pick(state.treatment, ["Necesito que escriba algo para continuar.", "Necesito que escribas algo para continuar."]);
  if (value.length > prompt.maxLength) return `Por favor, en ${prompt.maxLength} caracteres o menos.`;
  if (prompt.field === "contact") {
    if (state.contactMethod === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return pick(state.treatment, ["Ese correo no parece válido. ¿Puede revisarlo?", "Ese correo no parece válido. ¿Puedes revisarlo?"]);
    if (state.contactMethod !== "email" && value.replace(/\D/g, "").length < 7) return pick(state.treatment, ["Ese número parece incompleto. Incluya el código de país.", "Ese número parece incompleto. Incluye el código de país."]);
  }
  return null;
}

const isAuditComplete = (answers: Partial<AuditAnswers>): answers is AuditAnswers => AUDIT_DIMENSIONS.every((dimension) => answers[dimension] !== undefined);

function nextAfterName(state: ChatState): Step {
  return state.intent === "audit" ? "businessName" : "contactMethod";
}

export function advance(state: ChatState, input: string, pack: ClientPack): { state: ChatState; say: Say[] } {
  const t = (usted: string, tu: string) => pick(state.treatment, [usted, tu]);
  const say: Say[] = [];
  const text = (value: string) => say.push({ kind: "text", text: value });
  const value = input.trim();
  let next: ChatState = state;

  switch (state.step) {
    case "start": {
      const intent = INTENTS.find((id) => id === value);
      if (!intent) return { state, say };
      next = { ...state, intent };
      if (intent === "audit") {
        text(t("Perfecto. Empecemos por conocernos un poco.", "Perfecto. Empecemos por conocernos un poco."));
        next.step = "name";
        text(t("¿Cómo se llama?", "¿Cómo te llamas?"));
      } else if (intent === "question") {
        next.step = "question";
        text(t("Con gusto. Escriba su pregunta y la dejo lista para el equipo de Nova.", "Con gusto. Escribe tu pregunta y la dejo lista para el equipo de Nova."));
      } else if (intent === "client") {
        next.step = "name";
        text(t("Gracias por escribirnos. Aviso al equipo de Nova para que le atiendan.", "Gracias por escribirnos. Aviso al equipo de Nova para que te atiendan."));
        text(t("¿Cómo se llama?", "¿Cómo te llamas?"));
      } else {
        next.step = "name";
        text("Entendido: esto lo atiende una persona del equipo.");
        text(t("¿Cómo se llama?", "¿Cómo te llamas?"));
      }
      break;
    }
    case "question":
      next = { ...state, question: value, step: state.name ? "contactMethod" : "name" };
      text(t("Anotado. Una persona del equipo tiene que responder eso; yo no voy a inventar una respuesta.", "Anotado. Una persona del equipo tiene que responder eso; yo no voy a inventar una respuesta."));
      text(next.step === "name" ? t("¿Cómo se llama?", "¿Cómo te llamas?") : t("¿Cómo prefiere que le contacten?", "¿Cómo prefieres que te contacten?"));
      break;
    case "name":
      next = { ...state, name: value, step: nextAfterName(state) };
      text(`Mucho gusto, ${value}.`);
      text(next.step === "businessName" ? t("¿Cómo se llama su negocio? Puede omitirlo.", "¿Cómo se llama tu negocio? Puedes omitirlo.") : t("¿Cómo prefiere que le contacten?", "¿Cómo prefieres que te contacten?"));
      break;
    case "businessName":
      next = { ...state, businessName: value || undefined, step: "challenge" };
      if (value) text(`${value}, anotado.`);
      text(t("¿Cuál es hoy su mayor prioridad para el negocio?", "¿Cuál es hoy tu mayor prioridad para el negocio?"));
      break;
    case "challenge": {
      const challenge = CHALLENGES.find((id) => id === value);
      if (!challenge) return { state, say };
      next = { ...state, challenge, step: "audit", auditIndex: 0 };
      say.push({ kind: "reaction", text: `${CHALLENGE_LABEL[challenge]}: queda anotado para que el equipo lo tenga presente.` });
      text(t(`Ahora le haré ${AUDIT_DIMENSIONS.length} preguntas breves sobre cómo funciona su negocio. No hay respuestas buenas ni malas.`, `Ahora te haré ${AUDIT_DIMENSIONS.length} preguntas breves sobre cómo funciona tu negocio. No hay respuestas buenas ni malas.`));
      text(pick(state.treatment, DIMENSION_COPY[AUDIT_DIMENSIONS[0]].prompt));
      break;
    }
    case "audit": {
      const level = MATURITY_LEVELS.find((id) => id === value);
      if (!level) return { state, say };
      const dimension = AUDIT_DIMENSIONS[state.auditIndex];
      const answers = { ...state.answers, [dimension]: level as MaturityLevel };
      say.push({ kind: "reaction", text: DIMENSION_COPY[dimension].reaction[level] });
      if (state.auditIndex + 1 < AUDIT_DIMENSIONS.length) {
        next = { ...state, answers, auditIndex: state.auditIndex + 1 };
        text(pick(state.treatment, DIMENSION_COPY[AUDIT_DIMENSIONS[next.auditIndex]].prompt));
      } else {
        next = { ...state, answers, step: "qualBudget" };
        for (const step of ANALYSIS_STEPS) say.push({ kind: "working", text: pick(state.treatment, step) });
        if (isAuditComplete(answers)) {
          const result = runAudit(answers);
          const summary = buildSummary(result, { catalog: pack.catalog, treatment: state.treatment, businessName: state.businessName });
          say.push({
            kind: "result",
            score: result.score,
            band: result.band,
            infrastructure: result.infrastructure,
            status: scoreStatus(result, state.treatment, state.businessName),
            summary,
          });
        }
        text(t("Para que el equipo prepare una propuesta realista, tres preguntas más. Primero: ¿qué presupuesto mensual maneja aproximadamente?", "Para que el equipo prepare una propuesta realista, tres preguntas más. Primero: ¿qué presupuesto mensual manejas aproximadamente?"));
      }
      break;
    }
    case "qualBudget": {
      const budget = (Object.keys(BUDGET_LABEL) as Budget[]).find((id) => id === value);
      if (!budget) return { state, say };
      next = { ...state, budget, step: "qualTimeline" };
      text(t("¿Para cuándo le gustaría empezar?", "¿Para cuándo te gustaría empezar?"));
      break;
    }
    case "qualTimeline": {
      const timeline = (Object.keys(TIMELINE_LABEL) as Timeline[]).find((id) => id === value);
      if (!timeline) return { state, say };
      next = { ...state, timeline, step: "qualRole" };
      text(t("¿Qué papel tiene en la decisión?", "¿Qué papel tienes en la decisión?"));
      break;
    }
    case "qualRole": {
      const role = (Object.keys(ROLE_LABEL) as DecisionRole[]).find((id) => id === value);
      if (!role) return { state, say };
      next = { ...state, role, step: "contactMethod" };
      text(t("Gracias. ¿Cómo prefiere que le contacte el equipo de Nova?", "Gracias. ¿Cómo prefieres que te contacte el equipo de Nova?"));
      break;
    }
    case "contactMethod": {
      const method = CONTACT_METHODS.find((id) => id === value);
      if (!method) return { state, say };
      if (method === "none") {
        next = { ...state, contactMethod: method, step: "end" };
        text(t("Sin problema, no guardo ningún dato de contacto.", "Sin problema, no guardo ningún dato de contacto."));
        closing(next, pack, say);
      } else {
        next = { ...state, contactMethod: method, step: "contactValue" };
        text(t(`Perfecto. ¿Cuál es ${METHOD_VALUE[method]}?`, `Perfecto. ¿Cuál es ${METHOD_VALUE[method].replace("su ", "tu ")}?`));
      }
      break;
    }
    case "contactValue":
      next = { ...state, contact: value, step: "end" };
      closing(next, pack, say);
      break;
    case "end":
      return { state, say };
  }
  return { state: next, say };
}

// Everything a person at Nova needs to pick the conversation up without asking again.
export function buildHandoff(state: ChatState, pack: ClientPack): Handoff {
  const answers = isAuditComplete(state.answers) ? state.answers : undefined;
  const result = answers ? runAudit(answers) : undefined;
  const qualification = state.budget && state.timeline && state.role ? qualifyLead({ budget: state.budget, timeline: state.timeline, decisionRole: state.role, hasContact: Boolean(state.contact) }) : undefined;
  const method = state.contactMethod && state.contactMethod !== "none" ? state.contactMethod : null;
  const reasons: string[] = [];
  let route: Route;

  if (state.intent === "human") {
    route = "human";
    reasons.push("El visitante pidió hablar con una persona.");
  } else if (state.intent === "client") {
    route = "human";
    reasons.push("El visitante dice ser cliente actual.");
  } else if (state.intent === "question") {
    route = "human";
    reasons.push("Pregunta sin respuesta aprobada: necesita a una persona.");
  } else {
    route = qualification?.grade ?? "cold";
    reasons.push(`Prospecto ${{ hot: "caliente", warm: "tibio", cold: "frío" }[route as "hot" | "warm" | "cold"]} (${qualification?.points ?? 0} puntos).`);
  }
  if (!state.contact) reasons.push("No dejó un medio de contacto: no se le puede escribir.");

  const nextStep =
    route === "hot"
      ? "Contactar cuanto antes y proponer una llamada."
      : route === "warm"
        ? "Enviar información y proponer una llamada."
        : route === "cold"
          ? "Enviar información útil y dejar la puerta abierta."
          : "Responder personalmente a lo que pidió.";

  return {
    route,
    reasons,
    contact: method && state.contact ? { name: state.name, method, value: state.contact } : null,
    business: { name: state.businessName, challenge: state.challenge ? CHALLENGE_LABEL[state.challenge] : undefined },
    question: state.question,
    audit: result && answers ? { score: result.score, band: result.band, infrastructure: result.infrastructure, topGaps: result.gaps.slice(0, 3).map((gap) => gap.dimension), answers } : undefined,
    services: result ? buildSummary(result, { catalog: pack.catalog }).services.map((service) => service.serviceId) : [],
    qualification,
    nextStep,
  };
}

// In the demo nothing leaves the screen, so the closing says what would be handed over and never claims it was sent.
function closing(state: ChatState, pack: ClientPack, say: Say[]) {
  const handoff = buildHandoff(state, pack);
  const t = (usted: string, tu: string) => pick(state.treatment, [usted, tu]);
  const name = state.name ?? "";
  const lead =
    handoff.route === "hot"
      ? t(`Gracias, ${name}. Con lo que me contó, el equipo de Nova podría atenderle con prioridad.`, `Gracias, ${name}. Con lo que me contaste, el equipo de Nova podría atenderte con prioridad.`)
      : handoff.route === "warm"
        ? t(`Gracias, ${name}. El equipo de Nova podría contactarle para una llamada.`, `Gracias, ${name}. El equipo de Nova podría contactarte para una llamada.`)
        : handoff.route === "cold"
          ? t(`Gracias, ${name}. Quedo atento por si desea retomar cuando lo vea oportuno.`, `Gracias, ${name}. Quedo atento por si quieres retomar cuando lo veas oportuno.`)
          : t(`Gracias, ${name}. Una persona del equipo de Nova atenderá lo que pidió.`, `Gracias, ${name}. Una persona del equipo de Nova atenderá lo que pediste.`);
  say.push({ kind: "text", text: lead });
  say.push({
    kind: "text",
    text: pack.isDraft
      ? t("Esto es una demostración: no se envió nada. Así quedaría el traspaso que recibiría el equipo.", "Esto es una demostración: no se envió nada. Así quedaría el traspaso que recibiría el equipo.")
      : t("Ya dejé el resumen listo para el equipo.", "Ya dejé el resumen listo para el equipo."),
  });
  say.push({ kind: "handoff", handoff });
}
