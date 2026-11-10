// Every text KOE produces for an AI request lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esto lo decide una persona de la empresa; NEX y los Workers no cambian la configuración de la IA.",
    forbidden: "Solo quien configuró la IA de la empresa o sus administradores pueden hacer esto.",
    invalid: "No es válido: {detail}.",
    unknownPurpose: "KOE no conoce el propósito «{detail}»: un módulo pide un propósito, nunca un modelo.",
    unknownCaller: "«{detail}» no es un llamador conocido de KOE.",
    badDecision: "KOE armó una decisión que no es válida: {detail}.",
    moderated: "La solicitud no cumple las reglas de contenido ({detail}).",
    tooLong: "La solicitud supera el límite de tokens de entrada de la empresa.",
    rateLimited: "La empresa llegó a su límite de solicitudes por minuto.",
    overBudget: "La solicitud superaría el presupuesto mensual de IA de la empresa.",
    noModel: "Ningún modelo permitido cumple la solicitud: {detail}.",
  },
} as const;

export type ErrorCode = keyof typeof es.errors;

export function message(code: ErrorCode, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  void locale;
  return Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), es.errors[code] as string);
}
export const ERROR_CODES = Object.keys(es.errors) as ErrorCode[];
