// Every text the Developer Platform produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX solo puede preparar propuestas y, con una autorización, solicitar una publicación.",
    systemOnly: "Esto lo registra la plataforma, no una persona ni NEX.",
    forbidden: "Solo el propietario o quien desarrolla en la empresa puede hacer esto.",
    ownerRequired: "Esto solo lo hace el propietario de la empresa.",
    criticalForHuman: "Esto es una decisión crítica (credenciales, activar, publicar o logs): NEX nunca la prepara ni la hace.",
    notFound: "No existe.",
    notYours: "Pertenece a otra empresa.",
    invalid: "No es válido: {detail}.",
    exists: "Ya existe: {detail}.",
    needsAuthorization: "Solicitar una publicación necesita una autorización vigente del propietario o de quien desarrolla.",
    notEligible: "No se puede hacer así: {detail}.",
    noWorker: "KOE no encontró un Worker que pueda hacer el análisis: {detail}.",
    closed: "Ya fue resuelto.",
    notActive: "Está {detail}: no se puede usar.",
    scopeTooWide: "Los permisos pedidos superan los de la aplicación ({detail}).",
    exhausted: "Se agotaron los intentos de entrega.",
  },
  scope: {
    "crm.read": "CRM · leer", "crm.write": "CRM · escribir", "comms.read": "Comunicaciones · leer", "comms.write": "Comunicaciones · borradores", "insights.read": "Insights · leer",
    "org.read": "Organización · leer", "billing.read": "Facturación · leer", "workers.read": "Workers · leer", "workers.write": "Workers · pedir ejecuciones", "automations.write": "Automatizaciones · disparar",
  },
  event: {
    "crm.lead.created": "Prospecto creado", "crm.deal.updated": "Oportunidad actualizada", "comms.message.received": "Mensaje recibido", "billing.invoice.issued": "Factura emitida",
    "org.user.invited": "Persona invitada", "workers.run.completed": "Ejecución de un Worker terminada", "automations.run.failed": "Automatización fallida",
  },
  appKind: { app: "App", plugin: "Plugin", worker: "Worker", prompt: "Prompt", template: "Template", automation: "Automatización", connector: "Conector" },
  appStatus: { draft: "Borrador", active: "Activa", paused: "Pausada" },
  keyStatus: { active: "Activa", revoked: "Revocada", expired: "Expirada" },
  webhookStatus: { active: "Activo", paused: "Pausado", deleted: "Eliminado" },
  deliveryStatus: { delivered: "Entregado", failed: "Fallido", exhausted: "Sin más intentos" },
  publicationStatus: { requested: "Solicitada", approved: "Aprobada (nada se publica hoy)", rejected: "Rechazada" },
  versionStatus: { deprecated: "Se retirará", stable: "Estable", preview: "Vista previa" },
  rateStatus: { ok: "En orden", warn: "Cerca del límite", atLimit: "En el límite", over: "Por encima del límite" },
  rateLevel: { company: "Empresa", app: "Aplicación", key: "API Key", plan: "Plan" },
  severity: { normal: "Normal", high: "Alta" },
  proposalKind: { key: "API Key", webhook: "Webhook", app: "Aplicación" },
  proposalStatus: { proposed: "Propuesta de NEX", approved: "Aprobada", rejected: "Rechazada" },
  logKind: { request: "Peticiones", error: "Errores", event: "Eventos", webhook: "Webhooks", key: "API Keys", app: "Aplicaciones", access: "Acceso", proposal: "Propuestas", other: "Otros" },
  recommendation: { keyExpiring: "API Key por expirar", keyUnused: "API Key sin uso", webhookFailing: "Webhook con fallos", nearLimit: "Cerca del límite de peticiones", deprecatedVersion: "Versión que se retirará", errorRate: "Tasa de errores alta" },
  tabs: { dashboard: "Panel", keys: "API Keys", webhooks: "Webhooks", sandbox: "Sandbox", logs: "Logs", apps: "Marketplace Apps", explorer: "API Explorer", sdk: "SDK Center" },
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
