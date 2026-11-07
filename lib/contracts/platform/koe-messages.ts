// Every text the KOE (KYNOVA Orchestration Engine) and the Workers produce lives here, keyed by a code, so a translation is
// a new dictionary and nothing else. Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; un Worker no puede hacerla.",
    adminRequired: "Solo la administración de la plataforma puede hacer esto.",
    notYours: "Este recurso es de otra empresa.",
    tenantPaused: "La empresa tiene los Workers en pausa.",
    platformPaused: "La plataforma tiene los Workers en pausa.",
    definitionNotFound: "El Worker no existe.",
    definitionInvalid: "La definición del Worker no es válida: {detail}.",
    definitionExists: "Ya existe un Worker con ese identificador.",
    invalidTransition: "Un Worker {from} no puede pasar a {to}.",
    selfReview: "Quien envió el Worker a revisión no puede aprobarlo.",
    nothingToReview: "Este Worker no está pendiente de revisión.",
    reasonRequired: "Indique el motivo.",
    notActive: "El Worker no está activo.",
    instanceNotFound: "El Worker no está activado en esta empresa.",
    alreadyEnabled: "Este Worker ya está activado en la empresa.",
    instancePaused: "El Worker está en pausa.",
    runNotFound: "La ejecución no existe.",
    runNotRunning: "La ejecución no está en curso ({status}).",
    notThisWorker: "Solo el Worker de esta ejecución puede dar este paso.",
    dailyRunLimit: "El Worker llegó a su máximo de {max} ejecuciones por día.",
    stepLimit: "La ejecución llegó a su máximo de {max} pasos.",
    toolNotAllowed: "La herramienta «{tool}» no está permitida para este Worker.",
    toolNotGranted: "La herramienta «{tool}» no fue concedida en esta delegación.",
    toolUnknown: "La herramienta «{tool}» no existe o todavía no está aprobada.",
    inputInvalid: "Faltan datos para la herramienta: {detail}.",
    approvalNotFound: "La aprobación no existe.",
    approvalResolved: "Esta aprobación ya fue resuelta.",
    selfApproval: "Un movimiento de dinero lo aprueba una persona distinta de quien inició el trabajo.",
    noModel: "Ningún modelo cumple lo que pide la tarea: {detail}.",
    delegationNotAllowed: "«{from}» no puede delegar en «{to}».",
    delegationNotAccepted: "«{to}» no acepta trabajo de «{from}».",
    delegationCycle: "La delegación formaría un ciclo con «{to}».",
    delegationDepth: "Se alcanzó la profundidad máxima de delegación ({max}).",
    targetNotEnabled: "«{to}» no está activado en esta empresa.",
    grantInvalid: "Una delegación solo puede conceder herramientas del Worker receptor que sean de Nivel 1 o que el emisor ya tenga: {detail}.",
    childrenRunning: "Hay trabajo delegado en curso: termínelo o cancélelo primero.",
    memoryFull: "La memoria de trabajo está llena ({max} entradas).",
    memoryTooLong: "El valor supera los {max} caracteres.",
    memorySecret: "No se guardan secretos, claves ni datos de pago en la memoria.",
    memoryClearance: "El Worker no puede guardar datos de nivel «{level}» en su memoria.",
    memoryNotFound: "La entrada de memoria no existe.",
    memoryNotPromotable: "Esta entrada no se puede conservar: {detail}.",
    authorizationInvalid: "Una autorización solo aplica a acciones de Nivel 2 que el Worker tenga: {detail}.",
    authorizationNotFound: "La autorización no existe.",
    modelInvalid: "El modelo no es válido: {detail}.",
    modelNotFound: "El modelo no existe.",
    toolRegistrationInvalid: "La herramienta no es válida: {detail}.",
    toolExists: "Ya existe una herramienta con ese identificador.",
    toolNotFound: "La herramienta no existe.",
  },
  specialty: { coordination: "Coordinación", sales: "Ventas", followup: "Seguimiento", analysis: "Análisis", collections: "Cobranza", education: "Educación", support: "Atención al cliente", marketplace: "Marketplace", custom: "A medida" },
  definitionStatus: { draft: "Borrador", pendingReview: "En revisión", active: "Activo", retired: "Retirado" },
  instanceStatus: { active: "Activo", paused: "En pausa" },
  runStatus: { running: "En curso", waitingApproval: "Esperando aprobación", completed: "Completada", failed: "Fallida", cancelled: "Cancelada" },
  stepKind: { tool: "Herramienta", model: "Modelo", delegate: "Delegación", memory: "Memoria", note: "Nota", result: "Resultado" },
  decision: { allowed: "Permitido", needsApproval: "Pide aprobación", approved: "Aprobado", rejected: "Rechazado", refused: "Rechazado por regla", expired: "Venció" },
  level: { "1": "Nivel 1 · observa y prepara", "2": "Nivel 2 · autorizado", "3": "Nivel 3 · siempre confirma" },
  clearance: { public: "Público", business: "Del negocio", personal: "Datos personales" },
  modelClass: { reasoning: "Razonamiento", fast: "Rápido", vision: "Visión", code: "Código", longContext: "Contexto largo", embedding: "Embeddings", multilingual: "Multilingüe" },
  health: { healthy: "Sano", degraded: "Degradado", down: "Caído" },
  dataPolicy: { noTraining: "No entrena con sus datos", mayTrain: "Puede entrenar con sus datos", unknown: "Política desconocida" },
  origin: { kynova: "KYNOVA", tenant: "De la empresa" },
  memoryScope: { run: "De la ejecución", durable: "Conservada" },
  tabs: { workers: "Workers", runs: "Ejecuciones", models: "Modelos (KOE)", memory: "Memoria", build: "Crear", activity: "Actividad" },
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
