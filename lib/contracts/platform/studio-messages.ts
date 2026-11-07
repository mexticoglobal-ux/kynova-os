// Every text the AI Studio module produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added. No provider is ever named here.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX solo puede dejar borradores.",
    notFound: "No existe.",
    notYours: "Pertenece a otra empresa.",
    invalid: "No es válido: {detail}.",
    invalidState: "La versión está {from}; no puede pasar a {to}.",
    versionNotFound: "La versión no existe.",
    archived: "Está archivado; restáurelo antes de cambiarlo.",
    needsAuthorization: "Cambiar las asignaciones de un agente necesita una autorización vigente de una persona de la empresa.",
    promptNotPublished: "El prompt principal del agente debe tener una versión publicada.",
    limitReached: "El agente alcanzó un límite: {detail}.",
    noWorker: "KOE no encontró un Worker que pueda ejecutarlo: {detail}.",
    notEditableByAi: "NEX solo puede editar borradores sin versión publicada.",
    authorizationNotFound: "La autorización no existe.",
    shareInvalid: "No se puede compartir así: {detail}.",
    templateNotFound: "La plantilla no existe.",
    notPublished: "Solo una versión publicada puede convertirse en plantilla o compartirse.",
    shareClosed: "Este acuerdo ya no está pendiente.",
  },
  kind: { prompt: "Prompt", agent: "Agente IA" },
  status: { draft: "Borrador", inReview: "En revisión", published: "Publicado", archived: "Archivado" },
  versionState: { draft: "Borrador", pendingApproval: "Pendiente de aprobación", published: "Publicada", rejected: "Rechazada", superseded: "Reemplazada" },
  category: { sales: "Ventas", support: "Atención", marketing: "Marketing", education: "Educación", operations: "Operaciones", analysis: "Análisis", other: "Otra" },
  clearance: { public: "Datos públicos", business: "Datos del negocio", personal: "Datos personales" },
  tone: { formal: "Formal", friendly: "Cercano", technical: "Técnico", motivating: "Motivador" },
  memory: { none: "Sin memoria", session: "Solo la sesión", durable: "Duradera" },
  level: { "1": "Nivel 1 · prepara", "2": "Nivel 2 · con autorización", "3": "Nivel 3 · aprobación de una persona" },
  shareStatus: { proposed: "Propuesto", approved: "Aprobado (sin efecto todavía)", revoked: "Revocado" },
  tabs: { dashboard: "Panel", prompts: "Prompts", agents: "Agentes IA", builder: "Constructor", playground: "Playground", history: "Historial", templates: "Plantillas y compartir" },
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
