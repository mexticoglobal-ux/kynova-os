// Every text the Communications Hub produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added. No provider is ever named here.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX solo puede preparar.",
    systemOnly: "Esto lo registra la plataforma a través de KOE, no una persona ni NEX.",
    notFound: "No existe.",
    notYours: "Pertenece a otra empresa.",
    invalid: "No es válido: {detail}.",
    channelFuture: "Este canal es arquitectura futura: todavía no recibe conversaciones.",
    needsAuthorization: "Reasignar conversaciones necesita una autorización vigente de una persona de la empresa.",
    noWorker: "KOE no encontró un Worker que pueda atenderla: {detail}.",
    closedConversation: "La conversación está {status}; reábrala antes de cambiarla.",
    draftClosed: "Este borrador ya fue resuelto.",
    noChannelDraft: "Este canal no admite borradores todavía.",
    alreadyThere: "Ya está así.",
  },
  channel: { email: "Email", whatsapp: "WhatsApp", messenger: "Facebook Messenger", instagram: "Instagram Direct", webchat: "Chat Web", webform: "Formulario Web", sms: "SMS (arquitectura futura)" },
  status: { open: "Abierta", pending: "Pendiente", resolved: "Resuelta", archived: "Archivada" },
  urgency: { low: "Baja", normal: "Normal", high: "Alta", critical: "Crítica" },
  sentiment: { positive: "Positivo", neutral: "Neutral", negative: "Negativo", mixed: "Mixto" },
  intent: { buy: "Quiere comprar", support: "Pide soporte", billing: "Consulta de cobro", complain: "Reclamo", cancel: "Quiere cancelar", info: "Pide información", thanks: "Agradece", unknown: "No está claro" },
  category: { sales: "Ventas", support: "Soporte", billing: "Cobros", complaint: "Reclamo", general: "General" },
  nextBest: { reply: "Responder", escalate: "Escalar", assign: "Asignar", wait: "Esperar al cliente", resolve: "Marcar como resuelta" },
  draftKind: { email: "Correo", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", chat: "Respuesta de chat", form: "Respuesta de formulario" },
  draftStatus: { draft: "Borrador", ready: "Lista para que una persona la envíe", discarded: "Descartado" },
  entryKind: { email: "Correo", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", chat: "Chat", form: "Formulario", sms: "SMS", note: "Nota interna", worker: "Worker", automation: "Automatización", audit: "Business Audit", crm: "CRM", assignment: "Asignación", status: "Estado", tag: "Etiqueta", nex: "NEX", routing: "Enrutamiento de KOE" },
  tabs: { inbox: "Bandeja", conversation: "Conversación", timeline: "Línea de tiempo", drafts: "Borradores", assignments: "Asignaciones", intelligence: "Inteligencia" },
} as const;

const DICTIONARIES: Record<Locale, typeof es> = { es };

export type ErrorCode = keyof typeof es.errors;
export type LabelGroup = Exclude<keyof typeof es, "errors">;

export function message(code: ErrorCode, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  const template: string = (DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE]).errors[code];
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

export function label<G extends LabelGroup>(group: G, key: keyof (typeof es)[G] & string, locale: Locale = DEFAULT_LOCALE): string {
  return String((DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE])[group][key]);
}

export const ERROR_CODES = Object.keys(es.errors) as ErrorCode[];
