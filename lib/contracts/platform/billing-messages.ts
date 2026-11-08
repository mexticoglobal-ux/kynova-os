// Every text the Billing module produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX nunca cobra, cancela, renueva, emite pagos ni modifica facturas.",
    systemOnly: "Esto lo registra la plataforma, no una persona ni NEX.",
    forbidden: "Solo el propietario o quien administra la facturación de la empresa puede hacer esto.",
    ownerRequired: "Esto solo lo hace el propietario de la empresa.",
    criticalForHuman: "Esto es una decisión financiera crítica: NEX nunca la prepara ni la hace.",
    notFound: "No existe.",
    notYours: "Pertenece a otra empresa.",
    invalid: "No es válido: {detail}.",
    exists: "Ya existe: {detail}.",
    needsAuthorization: "Solicitar un upgrade necesita una autorización vigente del propietario o de quien administra la facturación.",
    notEligible: "No se puede hacer así: {detail}.",
    noWorker: "KOE no encontró un Worker que pueda hacer el análisis: {detail}.",
    closed: "Ya fue resuelto.",
    overLimit: "El uso actual supera lo que daría ese cambio ({detail}). No se toca ningún dato: reduzca el uso o elija otra opción.",
    notDue: "Todavía no toca renovar: la renovación se puede correr hasta {detail} días antes.",
    cancelled: "La suscripción está cancelada.",
    trialUsed: "La empresa ya usó su periodo de prueba.",
    samePlan: "Ya está en ese plan.",
    overpay: "El pago supera lo que se debe de esa factura.",
    nothingToPay: "Esa factura ya está pagada.",
  },
  resource: {
    users: "Usuarios", workers: "Workers IA", branches: "Sucursales", departments: "Departamentos", teams: "Equipos", storage: "Almacenamiento (GB)", academy: "Academy (cursos)", marketplace: "Marketplace (publicaciones)",
    integrations: "Integraciones", automations: "Automatizaciones", api: "API (llamadas al mes)", aiStudio: "AI Studio (activos)", communications: "Comunicaciones (canales)", crm: "CRM (contactos)", insights: "Insights (reportes)", aiTasks: "Tareas de KOE al mes",
  },
  addon: {
    extraUsers: "Usuarios extra (paquete de 5)", extraWorkers: "Workers extra (paquete de 2)", storage: "Almacenamiento (paquete de 50 GB)", academy: "Academy (paquete de 5 cursos)",
    marketplace: "Marketplace (paquete de 10 publicaciones)", automationPack: "Automation Pack (10 automatizaciones)", aiCredits: "Créditos de IA (1.000 tareas de KOE)",
  },
  accountStatus: { trialing: "En prueba", active: "Activa", cancelled: "Cancelada" },
  usageStatus: { ok: "En orden", warn: "Cerca del límite", atLimit: "En el límite", over: "Por encima del límite" },
  severity: { normal: "Normal", high: "Alta" },
  changeKind: { start: "Alta", upgrade: "Upgrade", downgrade: "Downgrade", trial: "Prueba", enterprise: "Enterprise", custom: "Plan personalizado", cancel: "Cancelación", reactivate: "Reactivación", expire: "Prueba vencida" },
  invoiceStatus: { open: "Pendiente", paid: "Pagada", overdue: "Vencida" },
  method: { simulatedCard: "Tarjeta (simulada)", simulatedTransfer: "Transferencia (simulada)", credit: "Crédito de la cuenta" },
  proposalKind: { plan: "Cambio de plan", addon: "Compra de add-on" },
  proposalStatus: { proposed: "Propuesta de NEX", approved: "Aprobada", rejected: "Rechazada" },
  auditCategory: { plan: "Plan y suscripción", addons: "Add-ons", invoices: "Facturas", payments: "Pagos", credits: "Créditos", proposals: "Propuestas", access: "Acceso a la facturación", other: "Otros" },
  department: { sales: "Ventas", marketing: "Marketing", support: "Soporte", finance: "Finanzas", operations: "Operaciones", unclassified: "Sin clasificar" },
  recommendation: { stay: "Mantener el plan", upgrade: "Subir de plan", downgrade: "Bajar de plan" },
  tabs: { dashboard: "Panel", plans: "Planes", licenses: "Licencias", addons: "Add-ons", invoices: "Facturación", ai: "Consumo IA", forecast: "Forecast", upgrade: "Upgrade Center" },
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
