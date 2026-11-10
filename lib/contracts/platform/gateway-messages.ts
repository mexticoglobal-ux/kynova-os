// Every text the AI Gateway produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    systemOnly: "Esto lo registra la plataforma, no una persona ni NEX.",
    koeOnly: "Solo KOE llama al gateway: quien necesite una IA se lo pide a KOE, nunca al gateway.",
    invalid: "No es válido: {detail}.",
    noModel: "El gateway no recibió ningún modelo que pueda servir: {detail}.",
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

const fill = (text: string, params: Record<string, string | number>): string => Object.entries(params).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text);

export function message(code: ErrorCode, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  void locale;
  return fill(es.errors[code], params);
}
export function reason(key: ReasonKey, params: Record<string, string | number> = {}, locale: Locale = DEFAULT_LOCALE): string {
  void locale;
  return fill(es.reasons[key], params);
}
export const ERROR_CODES = Object.keys(es.errors) as ErrorCode[];
