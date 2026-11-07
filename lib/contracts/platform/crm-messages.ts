// Every text the CRM module produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX solo puede preparar.",
    systemOnly: "Esto lo registra la plataforma (KOE y los demás módulos), no una persona ni NEX.",
    notFound: "No existe.",
    notYours: "Pertenece a otra empresa.",
    invalid: "No es válido: {detail}.",
    invalidMove: "No se puede pasar de «{from}» a «{to}».",
    needsAuthorization: "Mover etapas automáticamente necesita una autorización vigente de una persona de la empresa.",
    notEligible: "KOE no recomienda avanzar todavía: {detail}.",
    noWorker: "KOE no encontró un Worker que pueda hacer el análisis: {detail}.",
    taskClosed: "Esta tarea ya fue resuelta.",
    notWon: "Solo una venta ganada puede convertirse en cliente.",
    alreadyConverted: "Este prospecto ya es cliente.",
    closedDeal: "El negocio está cerrado; no se cambia por esta vía.",
  },
  stage: { prospect: "Prospecto", qualified: "Calificado", meeting: "Reunión", proposal: "Propuesta", negotiation: "Negociación", won: "Ganado", lost: "Perdido" },
  risk: { low: "Bajo", medium: "Medio", high: "Alto", critical: "Crítico" },
  taskKind: { call: "Llamar", email: "Enviar correo", whatsapp: "Enviar WhatsApp", meeting: "Programar reunión", proposal: "Enviar propuesta", followup: "Dar seguimiento" },
  taskStatus: { proposed: "Propuesta de NEX", accepted: "Aceptada por una persona", done: "Hecha", dismissed: "Descartada" },
  timelineKind: { email: "Correo", whatsapp: "WhatsApp", call: "Llamada", note: "Nota", meeting: "Reunión", automation: "Automatización", worker: "Worker", audit: "Business Audit", nex: "NEX" },
  linkKind: { product: "Productos", academy: "Academia", marketplace: "Marketplace", automation: "Automatizaciones", worker: "Workers", payment: "Pagos", referral: "Referidos" },
  priority: { low: "Baja", normal: "Normal", high: "Alta", critical: "Crítica" },
  tabs: { dashboard: "Dashboard", pipeline: "Pipeline", opportunity: "Oportunidad", timeline: "Línea de tiempo", tasks: "Tareas", customer: "Cliente 360", assistant: "Asistente de ventas" },
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
