// Every text the Academy module produces lives here, keyed by a code, so a translation is a new dictionary and nothing else.
// Only Spanish exists today: other locales fall back to it until their dictionary is added. (Course CONTENT has its own
// language field; this file is only the product's own text.)

export type Locale = "es";
export const DEFAULT_LOCALE: Locale = "es";

const es = {
  errors: {
    personRequired: "Esta acción la decide una persona; NEX no puede hacerla.",
    adminRequired: "Solo la administración de la plataforma puede hacer esto.",
    officialOnlyAdmin: "Los cursos oficiales de KYNOVA los gestiona solo la administración.",
    courseNotFound: "El curso no existe.",
    notYours: "Este curso es de otra empresa.",
    courseInvalid: "El curso no cumple los requisitos: {detail}.",
    invalidTransition: "Un curso {from} no puede pasar a {to}.",
    notEditable: "Un curso {status} no se puede editar.",
    reasonRequired: "Indique el motivo.",
    selfReview: "Quien envió el curso a revisión no puede aprobarlo.",
    nothingToReview: "No hay nada pendiente de revisar en este curso.",
    notPublished: "El curso no está publicado.",
    noAccess: "Su empresa no tiene acceso a este curso.",
    alreadyEnrolled: "Ya está inscrito en este curso.",
    notEnrolled: "Primero inscríbase en el curso.",
    lessonNotFound: "La lección no existe.",
    lessonLocked: "Complete primero las lecciones anteriores.",
    examNotFound: "El examen no existe.",
    completeLessonsFirst: "Complete las lecciones obligatorias antes del examen.",
    noAttemptsLeft: "Ya usó los {max} intentos de este examen.",
    attemptInProgress: "Ya tiene un intento de este examen en curso.",
    noAttempt: "No hay un intento en curso de este examen.",
    answerInvalid: "Una respuesta no corresponde a las opciones del examen.",
    notEligible: "Todavía no cumple los requisitos del certificado: {detail}.",
    certificatesOff: "Este curso no emite certificado.",
    alreadyCertified: "Ya tiene un certificado vigente de este curso.",
    certificateNotFound: "El certificado no existe.",
    certificateRevoked: "Este certificado ya fue revocado.",
    tutorDisabled: "El tutor de NEX no está activado en este curso.",
    tutorLimit: "Llegó al máximo de {max} preguntas al tutor por hoy.",
    tutorBlockedExam: "El tutor no está disponible mientras hay un examen en curso.",
    turnNotFound: "La pregunta no existe.",
    turnResolved: "Esta pregunta ya tiene respuesta.",
    ungrounded: "Una respuesta del tutor debe apoyarse en lecciones del curso.",
    answerTooLong: "La respuesta no puede pasar de {max} caracteres.",
    aiOnly: "Solo el tutor (NEX) responde así; una persona responde con «responder».",
    entitlementExists: "Esta empresa ya tiene acceso a este curso.",
    entitlementNotFound: "El acceso no existe.",
    notForSale: "Este curso no está preparado para venderse.",
    refRequired: "Indique la referencia de la compra.",
  },
  courseStatus: { draft: "Borrador", pendingReview: "En revisión", published: "Publicado", archived: "Archivado" },
  origin: { own: "De la empresa", official: "Oficial KYNOVA" },
  distribution: { internal: "Solo mi equipo", marketplace: "A la venta en el Marketplace" },
  lessonKind: { video: "Video", pdf: "PDF", file: "Archivo", text: "Lectura" },
  mediaSource: { hosted: "Alojado en KYNOVA", youtubePrivate: "YouTube privado", premium: "Contenido premium" },
  mediaState: { available: "Disponible", planned: "Preparado, aún no conectado" },
  questionKind: { single: "Una respuesta", multiple: "Varias respuestas", trueFalse: "Verdadero o falso" },
  attemptStatus: { inProgress: "En curso", graded: "Calificado", expired: "Vencido" },
  tutorStatus: { pending: "Esperando respuesta", answered: "Respondida por NEX", escalated: "Enviada al instructor", instructorReplied: "Respondida por el instructor" },
  certificateStatus: { valid: "Vigente", revoked: "Revocado" },
  entitlementSource: { marketplace: "Compra en el Marketplace", grant: "Concedido por la empresa", plan: "Incluido en el plan" },
  language: { es: "Español", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", pt: "Português", ja: "日本語", zh: "中文" },
  tabs: { catalog: "Catálogo", learning: "Mi aprendizaje", teach: "Enseñar", admin: "Oficiales", certificates: "Certificados", activity: "Actividad" },
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
