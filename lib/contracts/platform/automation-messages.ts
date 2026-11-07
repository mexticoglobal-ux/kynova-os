// Every text the Automations module produces lives here, keyed by a code, so a translation is a new dictionary and nothing
// else. Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX solo puede dejar borradores.",
    notFound: "La automatización no existe.",
    notYours: "Esta automatización es de otra empresa.",
    invalid: "La automatización no es válida: {detail}.",
    invalidTransition: "Una automatización {from} no puede pasar a {to}.",
    activeCannotDelete: "Pause la automatización antes de eliminarla.",
    tenantPaused: "Las automatizaciones de la empresa están detenidas.",
    notManual: "Solo una automatización con disparador manual se ejecuta a mano.",
    notActive: "La automatización no está activa.",
    outputNotFound: "El resultado no existe.",
    outputResolved: "Este resultado ya fue resuelto.",
    triggerInvalid: "El evento no es válido: {detail}.",
    notEditableByAi: "NEX solo puede editar borradores.",
    workerRequired: "Asigne un Worker a la automatización antes de activarla, probarla o ponerla en vivo.",
  },
  trigger: { newProspect: "Nuevo prospecto", newClient: "Nuevo cliente", paymentReceived: "Pago recibido", meetingCreated: "Reunión creada", formSubmitted: "Formulario enviado", manual: "Manual" },
  action: { createTask: "Crear tarea", createReminder: "Crear recordatorio", notifyInternal: "Notificación interna", prepareEmail: "Preparar correo (sin enviarlo)", prepareWhatsapp: "Preparar WhatsApp (sin enviarlo)", createPendingEvent: "Crear evento pendiente" },
  status: { setupPending: "Configuración pendiente", draft: "Borrador", active: "Activa", paused: "Pausada" },
  runStatus: { completed: "Completada", testLogged: "Prueba (no creó nada)", skipped: "Omitida", failed: "Con errores" },
  outputKind: { task: "Tarea", reminder: "Recordatorio", notification: "Notificación", emailDraft: "Borrador de correo", whatsappDraft: "Borrador de WhatsApp", pendingEvent: "Evento pendiente" },
  outputStatus: { open: "Pendiente", done: "Hecho", dismissed: "Descartado" },
  role: { owner: "Propietario", admin: "Administración", member: "Equipo", team: "Todo el equipo" },
  op: { equals: "es igual a", notEquals: "es distinto de", greaterThan: "es mayor que", lessThan: "es menor que", contains: "contiene" },
  field: {
    nombre: "Nombre", empresa: "Empresa", correo: "Correo", telefono: "Teléfono", puntaje: "Puntaje", origen: "Origen", cliente: "Cliente", monto: "Monto", moneda: "Moneda", metodo: "Método",
    referencia: "Referencia", titulo: "Título", fecha: "Fecha", contacto: "Contacto", formulario: "Formulario", mensaje: "Mensaje",
  },
  tabs: { list: "Automatizaciones", build: "Crear y editar", simulate: "Simular eventos", results: "Resultados", activity: "Actividad" },
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

/** A label for a field that may not be in the dictionary (a free manual field): falls back to the field's own name. */
export const fieldLabel = (key: string): string => (key in es.field ? es.field[key as keyof typeof es.field] : key);

export const ERROR_CODES = Object.keys(es.errors) as ErrorCode[];
