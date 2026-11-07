// Every text the Insights module produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX solo puede preparar borradores.",
    systemOnly: "Las métricas las registra la plataforma; ni una persona ni NEX las escriben a mano.",
    notFound: "No existe.",
    notYours: "Pertenece a otra empresa.",
    invalid: "No es válido: {detail}.",
    invalidState: "Está {from}; no puede pasar a {to}.",
    factNotFound: "La métrica a corregir no existe.",
    notApproved: "El reporte debe estar aprobado por una persona antes de programarlo o compartirlo.",
    correctionClosed: "Esta corrección ya fue resuelta.",
  },
  view: { executive: "Resumen ejecutivo", analytics: "Analítica", ai: "IA", productivity: "Productividad", financial: "Finanzas", customers: "Clientes", koe: "KOE" },
  module: { sales: "Ventas", marketing: "Marketing", seo: "SEO", crm: "CRM", academy: "Academia", marketplace: "Marketplace", referrals: "Referidos", automations: "Automatizaciones", workers: "Workers", payments: "Pagos", integrations: "Integraciones" },
  department: { sales: "Ventas", marketing: "Marketing", support: "Atención", finance: "Finanzas", operations: "Operaciones" },
  reportStatus: { draft: "Borrador", approved: "Aprobado" },
  frequency: { none: "Sin programar", weekly: "Semanal", monthly: "Mensual" },
  correctionStatus: { proposed: "Propuesta", approved: "Aprobada", rejected: "Rechazada" },
  tabs: { executive: "Resumen ejecutivo", analytics: "Analítica", ai: "IA", productivity: "Productividad", financial: "Finanzas", customers: "Clientes", koe: "KOE", reports: "Reportes" },
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
