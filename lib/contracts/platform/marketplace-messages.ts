// Every text the Marketplace produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added.

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX no puede hacerla.",
    adminRequired: "Solo la administración de la plataforma puede hacer esto.",
    notYours: "Esta publicación es de otra empresa.",
    listingNotFound: "La publicación no existe.",
    listingInvalid: "La publicación no cumple los requisitos: {detail}.",
    invalidTransition: "Una publicación {from} no puede pasar a {to}.",
    inReview: "La publicación está en revisión: espere la decisión antes de cambiarla.",
    notEditable: "Una publicación {status} no se puede editar.",
    reasonRequired: "Indique el motivo.",
    selfReview: "Quien envió la publicación no puede aprobarla.",
    nothingToReview: "No hay nada pendiente de revisar en esta publicación.",
    notPublished: "La publicación no está publicada.",
    ownListing: "Una empresa no puede comprar su propia publicación.",
    alreadyOwned: "Esta empresa ya tiene esta publicación activa.",
    purchaseNotFound: "La compra no existe.",
    notYourPurchase: "Esta compra es de otra empresa.",
    purchaseInactive: "La compra no está activa.",
    notCancellable: "Una compra de precio único no se cancela: ya está pagada.",
    renewalNotDue: "La renovación todavía no corresponde ({date}).",
    noDeliverable: "Esta publicación no tiene archivo para descargar.",
    suspendedNoAccess: "La publicación está suspendida: no se puede descargar.",
    downloadLimit: "Se alcanzó el máximo de {max} descargas para esta compra.",
    reviewNotAllowed: "Solo quien compró puede reseñar.",
    alreadyReviewed: "Esta compra ya tiene una reseña.",
    ratingInvalid: "La calificación va de 1 a 5.",
    reviewTooLong: "La reseña no puede pasar de {max} caracteres.",
    reviewNotFound: "La reseña no existe.",
    alreadyReplied: "Esta reseña ya tiene respuesta.",
    shareInvalid: "El reparto debe ser un entero entre 0 y {max} puntos base.",
    shareUnchanged: "El reparto propuesto es igual al actual.",
    sharePending: "Ya hay un cambio de reparto en espera para este alcance.",
    shareChangeNotFound: "El cambio de reparto no existe.",
    shareChangeResolved: "Este cambio de reparto ya fue resuelto.",
    selfApproval: "Quien propone un cambio económico no puede aprobarlo.",
    currencyInvalid: "Moneda no válida para liquidaciones.",
    nothingToSettle: "Este vendedor no tiene ingresos por liquidar en esa moneda.",
    settlementBelowMinimum: "El total no alcanza el mínimo de liquidación ({min}).",
    settlementNotFound: "La liquidación no existe.",
    settlementResolved: "Esta liquidación ya fue resuelta.",
    settlementNotApproved: "Solo una liquidación aprobada puede marcarse como pagada.",
    paymentRefRequired: "Indique la referencia del pago hecho fuera de la plataforma.",
  },
  itemKind: { product: "Producto", service: "Servicio", course: "Curso", aiAgent: "Agente IA", automation: "Automatización", app: "App", digitalResource: "Recurso digital" },
  category: { marketing: "Marketing", sales: "Ventas", finance: "Finanzas", operations: "Operaciones", education: "Educación", design: "Diseño", support: "Atención al cliente", development: "Desarrollo", industry: "Industrias" },
  listingStatus: { draft: "Borrador", pending: "En revisión", published: "Publicada", rejected: "Rechazada", suspended: "Suspendida", retired: "Retirada" },
  pricingModel: { free: "Gratis", oneTime: "Precio único", subscription: "Suscripción" },
  purchaseStatus: { active: "Activa", cancelled: "Cancelada" },
  chargeStatus: { accrued: "Por liquidar", inSettlement: "En liquidación", settled: "Liquidado" },
  settlementStatus: { requested: "Solicitada", approved: "Aprobada", paid: "Pagada", rejected: "Rechazada" },
  shareStatus: { requested: "En espera", approved: "Aprobado", rejected: "Rechazado" },
  sort: { relevance: "Más relevantes", newest: "Más nuevas", rating: "Mejor calificadas", priceAsc: "Precio: menor a mayor", priceDesc: "Precio: mayor a menor", popular: "Más vendidas" },
  tabs: { catalog: "Catálogo", purchases: "Mis compras", favorites: "Favoritos", sell: "Vender", moderation: "Moderación", admin: "Administración", activity: "Actividad" },
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
