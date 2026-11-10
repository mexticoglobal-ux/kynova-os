// Every text the AI Gateway produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esto lo decide una persona de la empresa; NEX y los Workers no cambian la configuración de la IA.",
    systemOnly: "Esto lo registra la plataforma, no una persona ni NEX.",
    forbidden: "Solo quien configuró la IA de la empresa o sus administradores pueden hacer esto.",
    invalid: "No es válido: {detail}.",
    unknownPurpose: "El gateway no conoce el propósito «{detail}»: un módulo pide un propósito, nunca un modelo.",
    unknownCaller: "«{detail}» no es un llamador conocido del gateway.",
    moderated: "La solicitud no cumple las reglas de contenido ({detail}).",
    tooLong: "La solicitud supera el límite de tokens de entrada de la empresa.",
    rateLimited: "La empresa llegó a su límite de solicitudes por minuto.",
    overBudget: "La solicitud superaría el presupuesto mensual de IA de la empresa.",
    noModel: "Ningún modelo permitido cumple la solicitud: {detail}.",
    allFailed: "Ningún proveedor pudo responder: {detail}.",
  },
  reasons: {
    providerFailed: "el proveedor falló en esta llamada",
    circuitOpen: "cortacircuitos abierto",
    retry: "reintento tras una falla temporal",
    fallback: "respaldo: {detail}",
  },
} as const;

export type ErrorCode = keyof typeof es.errors;
export type ReasonKey = keyof typeof es.reasons;

export function message(code: ErrorCode, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  void locale;
  return Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), es.errors[code] as string);
}
export function reason(key: ReasonKey, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  void locale;
  return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), es.reasons[key] as string);
}
export const ERROR_CODES = Object.keys(es.errors) as ErrorCode[];
