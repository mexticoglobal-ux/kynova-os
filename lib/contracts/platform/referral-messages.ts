// Every text the Referrals module produces lives here, keyed by a code, so a translation is a new dictionary and nothing
// else. Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    tenantMismatch: "Este evento pertenece a otra empresa.",
    noProgram: "Primero configure el programa de referidos.",
    programInactive: "El programa no está activo.",
    programInvalid: "Programa inválido: {detail}.",
    nameRequired: "El nombre es obligatorio.",
    emailInvalid: "El correo no es válido.",
    affiliateExists: "Ya existe un afiliado con ese correo.",
    affiliateNotFound: "El afiliado no existe.",
    affiliateSuspended: "El afiliado está suspendido.",
    codeNotFound: "El código no existe.",
    sponsorNotFound: "El código del patrocinador no existe.",
    referralNotFound: "No hay un referido abierto para ese correo.",
    invalidTransition: "Un referido {from} no puede pasar a {to}.",
    alreadyConverted: "Esta persona ya es cliente.",
    outsideWindow: "El último contacto quedó fuera de la ventana de atribución.",
    saleDuplicate: "Esa venta ya fue registrada.",
    saleNotFound: "No hay una venta registrada con esa referencia.",
    currencyMismatch: "La venta debe estar en {currency}, la moneda del programa.",
    saleInvalid: "El monto de la venta debe ser un entero positivo en unidades menores.",
    commissionNotFound: "La comisión no existe.",
    commissionNotReviewable: "Una comisión {status} no se puede revisar.",
    commissionInPayout: "La comisión está en un pago en trámite: resuélvalo primero.",
    holdNotElapsed: "La comisión sigue en periodo de espera hasta el {date}.",
    personRequired: "Esta acción la decide una persona; NEX no puede hacerla.",
    selfApproval: "Quien solicita un pago no puede aprobarlo.",
    payoutNotFound: "El pago de comisiones no existe.",
    payoutResolved: "Este pago de comisiones ya fue resuelto.",
    payoutNotApproved: "Solo un pago aprobado puede marcarse como pagado.",
    payoutBelowMinimum: "El total no alcanza el mínimo de pago ({min}).",
    nothingToPay: "No hay comisiones aprobadas por pagar.",
    paymentRefRequired: "Indique la referencia del pago hecho fuera de la plataforma.",
    currencyInvalid: "Moneda no válida para comisiones.",
  },
  referralStatus: { clicked: "Hizo clic", signedUp: "Registrado", qualified: "Calificado", converted: "Convertido", rejected: "Rechazado", expired: "Vencido" },
  commissionStatus: { pending: "Pendiente", held: "Retenida", approved: "Aprobada", inPayout: "En pago", paid: "Pagada", rejected: "Rechazada", reversed: "Revertida" },
  payoutStatus: { requested: "Solicitado", approved: "Aprobado", paid: "Pagado", rejected: "Rechazado" },
  affiliateStatus: { active: "Activo", suspended: "Suspendido" },
  programStatus: { draft: "Borrador", active: "Activo", paused: "En pausa", ended: "Terminado" },
  fraudSignal: {
    selfReferral: "Autorreferido",
    sameEmail: "Mismo correo que el afiliado",
    sameDevice: "Mismo dispositivo que el afiliado",
    refundedSale: "Venta reembolsada",
    burst: "Ráfaga de referidos en una hora",
    suspendedAffiliate: "Afiliado suspendido",
  },
  rejectReason: { lostAttribution: "Otro afiliado tuvo el último contacto", expired: "Venció la ventana de atribución", manual: "Rechazado manualmente" },
  tabs: {
    overview: "Resumen",
    program: "Programa",
    affiliates: "Afiliados",
    referrals: "Referidos",
    commissions: "Comisiones",
    payouts: "Pagos de comisiones",
    fraud: "Fraude",
    activity: "Actividad",
  },
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
