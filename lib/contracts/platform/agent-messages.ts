// Every text the AI Agent Runtime produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Una sesión de agente la inicia, aprueba o cancela una persona de la empresa; NEX y los Workers solo preparan.",
    systemOnly: "Esto lo registra la plataforma, no una persona ni NEX.",
    invalid: "No es válido: {detail}.",
    notFound: "La sesión no existe.",
    notYours: "La sesión pertenece a otra empresa.",
    notAllowed: "Solo una persona, la plataforma o el propio agente pueden avanzar esta sesión.",
    playbookNotFound: "No existe el plan «{detail}».",
    workerMismatch: "El plan «{detail}» es de otro Worker.",
    missingParam: "Falta el dato «{detail}» para iniciar el plan.",
    planInvalid: "El plan no es válido: {detail}.",
    waiting: "La sesión espera la decisión de una persona.",
    escalated: "La sesión se escaló a una persona y no avanza sola.",
    finished: "La sesión ya terminó.",
    notWaiting: "La sesión no espera ninguna aprobación.",
    notEscalated: "La sesión no está escalada.",
    koeRefused: "KOE no lo permitió: {detail}.",
  },
  reasons: {
    stopped: "Se detuvo: {detail}.",
    retry: "Falla temporal; se reintenta ({attempt} de {max}).",
    outOfRetries: "Agotó los reintentos: {detail}.",
    escalated: "Se escaló a una persona: {detail}.",
    waiting: "Espera la decisión de una persona sobre «{detail}».",
    rejected: "Una persona rechazó «{detail}».",
  },
  stop: {
    steps: "llegó al máximo de pasos",
    aiCalls: "llegó al máximo de llamadas a la IA",
    budget: "superó el presupuesto de la sesión",
    timeout: "superó el tiempo máximo",
    loop: "repitió el mismo paso demasiadas veces",
    killSwitch: "los Workers están en pausa o deshabilitados",
    rejected: "una persona rechazó una acción",
    cancelled: "una persona la canceló",
  },
} as const;

export type ErrorCode = keyof typeof es.errors;
export type ReasonKey = keyof typeof es.reasons;
export type StopKey = keyof typeof es.stop;

const fill = (text: string, params: Record<string, string | number>): string => Object.entries(params).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text);

export function message(code: ErrorCode, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  void locale;
  return fill(es.errors[code], params);
}
export function reason(key: ReasonKey, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  void locale;
  return fill(es.reasons[key], params);
}
export const stopText = (key: StopKey, locale: Locale = DEFAULT_LOCALE): string => {
  void locale;
  return es.stop[key];
};
export const ERROR_CODES = Object.keys(es.errors) as ErrorCode[];
export const STOP_KEYS = Object.keys(es.stop) as StopKey[];
