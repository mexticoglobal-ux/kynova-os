// Every text the Organization module produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX solo puede preparar propuestas.",
    systemOnly: "Esto lo registra la plataforma, no una persona ni NEX.",
    forbidden: "Su rol no le permite hacer esto en la organización.",
    adminRequired: "Esto solo lo hace un administrador de la empresa.",
    criticalForHuman: "Esto toca un rol o un permiso crítico: NEX nunca lo prepara ni lo hace.",
    notFound: "No existe.",
    notYours: "Pertenece a otra empresa.",
    invalid: "No es válido: {detail}.",
    exists: "Ya existe: {detail}.",
    lastAdmin: "Debe quedar al menos un administrador activo.",
    ownerProtected: "El propietario no se cambia por esta vía: solo él puede transferir la propiedad.",
    needsAuthorization: "Mover usuarios entre equipos necesita una autorización vigente de un administrador.",
    notEligible: "No se puede mover así: {detail}.",
    noWorker: "KOE no encontró un Worker que pueda hacer el análisis: {detail}.",
    closed: "Ya fue resuelto.",
    immutable: "Este rol no se puede cambiar.",
    notYourOwn: "Esto solo lo cambia la propia persona.",
  },
  status: { pending: "Pendiente", active: "Activo", suspended: "Suspendido", disabled: "Deshabilitado" },
  invitationStatus: { pending: "Pendiente", accepted: "Aceptada", revoked: "Revocada" },
  availability: { available: "Disponible", busy: "Ocupado", away: "Ausente", paused: "En pausa", disabled: "Deshabilitado" },
  module: { crm: "CRM", academy: "Academy", marketplace: "Marketplace", workers: "Workers", insights: "Insights", payments: "Pagos", communications: "Comunicaciones", aiStudio: "AI Studio", automations: "Automatizaciones", integrations: "Integraciones", developer: "Developer Center" },
  level: { none: "Sin acceso", read: "Lectura", write: "Escritura", manage: "Administración" },
  severity: { low: "Baja", normal: "Normal", high: "Alta", critical: "Crítica" },
  proposalKind: { invite: "Invitación", team: "Equipo", move: "Mover de equipo", roleChange: "Cambio de rol" },
  proposalStatus: { proposed: "Propuesta de NEX", approved: "Aprobada", rejected: "Rechazada" },
  auditCategory: { invitations: "Invitaciones", roles: "Cambios de rol", permissions: "Permisos", teams: "Equipos", branches: "Sucursales", workers: "Workers", users: "Usuarios", identity: "Identidad", other: "Otros" },
  tabs: { dashboard: "Panel", tree: "Organigrama", users: "Usuarios", teams: "Equipos", roles: "Roles", permissions: "Permisos", branches: "Sucursales", identity: "Identidad", workforce: "Fuerza de trabajo" },
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
