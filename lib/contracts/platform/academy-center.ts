// Academy Center store: courses of each company, official KYNOVA courses, courses sold in the Marketplace, lessons with
// videos, PDFs and files, exams, progress, certificates and NEX as a tutor. Pure and deterministic, one global state with
// every record owned by a company (tenant): a company only sees its own learners, progress, attempts and certificates.
//
// No real APIs or media: files are named references, and YouTube-private and premium sources are only declared (they are
// "planned", and a course that uses one cannot be published yet).
//
// Constitution (ADR-0009):
// - NEX may prepare a course draft (Level 1). It never publishes, approves, grades, certifies or sells.
// - NEX as TUTOR is Level 2: it answers only from the course's own lessons, only if the course owner switched the tutor on
//   (that switch is the authorization), within a daily limit, and never while an exam is in progress.
// - Exams are graded by code, never by a model. A certificate follows from a rule (lessons done, required exams passed);
//   only a person or the system claims it, and only a person revokes it.
// - Official KYNOVA courses need a second administrator's approval. Selling a course goes through the Marketplace's own approval.

import { isPerson, isWorker } from "./actors";
import { isCurrency, isCrypto, type CurrencyCode } from "./currency";
import { label, message, type ErrorCode } from "./academy-messages";
import type { ListingContent, MarketPricing } from "./marketplace-center";
import { decide as decideAutonomy, type Authorization } from "./workers";

// ---------------------------------------------------------------- vocabulary
export const COURSE_LANGUAGES = ["es", "en", "fr", "de", "it", "pt", "ja", "zh"] as const;
export type CourseLanguage = (typeof COURSE_LANGUAGES)[number];

export type MediaSource = "hosted" | "youtubePrivate" | "premium";
// Same idea as the integration manifests: what is declared, and what is not connected yet.
export const MEDIA_SOURCES: Record<MediaSource, { available: boolean; toVerify: readonly string[] }> = {
  hosted: { available: true, toVerify: [] },
  youtubePrivate: { available: false, toVerify: ["Autorización OAuth de la empresa y permiso de incrustación", "Videos no listados o privados: quién puede verlos", "Cuotas y políticas de YouTube", "Cuándo se corta el acceso al retirar un curso"] },
  premium: { available: false, toVerify: ["Proveedor de contenido premium y su licencia", "Protección contra copia (DRM) y marcas de agua", "Derechos por empresa y por alumno", "Reglas de reembolso del contenido"] },
};

export type LessonKind = "video" | "pdf" | "file" | "text";
export type Media = { source: "hosted"; fileName: string; sizeBytes: number } | { source: "youtubePrivate"; videoId: string } | { source: "premium"; assetId: string };
export type CourseLesson = {
  id: string;
  title: string;
  kind: LessonKind;
  minutes: number;
  required: boolean;
  media?: Media;
  body?: string; // reading text or transcript: the only material the tutor may answer from
};

export type QuestionKind = "single" | "multiple" | "trueFalse";
export type Question = { id: string; text: string; kind: QuestionKind; options: readonly { id: string; text: string }[]; correct: readonly string[]; points: number };
export type Exam = { id: string; title: string; passPercent: number; maxAttempts: number; timeLimitMinutes?: number; required: boolean; requiresCompletion: boolean; questions: readonly Question[] };

export type CourseContent = {
  title: string;
  summary: string;
  description: string;
  language: CourseLanguage;
  tags: readonly string[];
  sequential: boolean; // lessons unlock one after another
  lessons: readonly CourseLesson[];
  exams: readonly Exam[];
  certificate: { enabled: boolean };
  tutor: { enabled: boolean; dailyLimit: number }; // the course owner's authorization for NEX to answer
  sale?: { pricing: MarketPricing; currency: CurrencyCode };
};

export type CourseStatus = "draft" | "pendingReview" | "published" | "archived";
export type CourseOrigin = "own" | "official";
export type CourseDistribution = "internal" | "marketplace";
export type CourseReview = { at: string; actor: string; action: "submitted" | "approved" | "rejected" | "revisionSubmitted" | "revisionApproved" | "revisionRejected" | "archived"; reason?: string };
export type Course = {
  id: string;
  ownerTenantId: string;
  origin: CourseOrigin;
  distribution: CourseDistribution;
  status: CourseStatus;
  version: number;
  content: CourseContent;
  createdBy: string;
  createdAt: string;
  submittedBy?: string;
  publishedAt?: string;
  pendingRevision?: { content: CourseContent; submittedBy: string; submittedAt: string };
  review: readonly CourseReview[];
};

export type Entitlement = { id: string; courseId: string; tenantId: string; source: "marketplace" | "grant" | "plan"; ref: string; status: "active" | "revoked"; at: string };
export type Enrollment = { id: string; courseId: string; tenantId: string; userId: string; name: string; enrolledAt: string; completed: readonly string[] };
export type Attempt = {
  id: string; courseId: string; examId: string; tenantId: string; userId: string; startedAt: string; status: "inProgress" | "graded" | "expired";
  submittedAt?: string; answers?: Readonly<Record<string, readonly string[]>>; scorePercent?: number; passed?: boolean; wrong?: readonly string[];
};
export type Certificate = { id: string; code: string; courseId: string; courseTitle: string; issuerTenantId: string; tenantId: string; userId: string; holderName: string; issuedAt: string; scorePercent: number | null; status: "valid" | "revoked"; revokedReason?: string };
export type TutorStatus = "pending" | "answered" | "escalated" | "instructorReplied";
export type TutorTurn = { id: string; courseId: string; tenantId: string; userId: string; lessonId?: string; question: string; status: TutorStatus; answer?: string; sources: readonly string[]; answeredBy?: string; at: string; answeredAt?: string };

export type AcademyAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type AcademyLog = { at: string; level: "info" | "warn"; event: string };

export type AcademyState = {
  admins: readonly string[];
  courses: readonly Course[];
  entitlements: readonly Entitlement[];
  enrollments: readonly Enrollment[];
  attempts: readonly Attempt[];
  certificates: readonly Certificate[];
  tutorTurns: readonly TutorTurn[];
  audit: readonly AcademyAudit[];
  logs: readonly AcademyLog[];
  sequence: number;
};

export const newAcademyState = (admins: readonly string[] = []): AcademyState => ({ admins, courses: [], entitlements: [], enrollments: [], attempts: [], certificates: [], tutorTurns: [], audit: [], logs: [], sequence: 0 });

export const MAX_TUTOR_ANSWER_CHARS = 1_500;
export const TUTOR_MAX_DAILY_LIMIT = 50;

// ---------------------------------------------------------------- objective review
const EXTENSIONS: Record<Exclude<LessonKind, "text">, readonly string[]> = {
  video: ["mp4", "webm"],
  pdf: ["pdf"],
  file: ["zip", "docx", "xlsx", "pptx", "pdf", "png", "jpg", "csv", "txt"], // no executables or scripts, ever
};
const MAX_BYTES: Record<Exclude<LessonKind, "text">, number> = { video: 2_000_000_000, pdf: 100_000_000, file: 200_000_000 };

/** The objective checks a course must pass to be published. A person still decides on official courses. */
export function courseIssues(content: CourseContent): string[] {
  const issues: string[] = [];
  if (content.title.trim() === "" || content.title.length > 120) issues.push("título (1 a 120 caracteres)");
  if (content.summary.trim() === "" || content.summary.length > 240) issues.push("resumen (1 a 240 caracteres)");
  if (!COURSE_LANGUAGES.includes(content.language)) issues.push("idioma del curso");
  if (content.lessons.length === 0) issues.push("al menos una lección");
  const ids = new Set<string>();
  for (const lesson of content.lessons) {
    if (ids.has(lesson.id)) issues.push(`lección repetida (${lesson.id})`);
    ids.add(lesson.id);
    if (lesson.title.trim() === "") issues.push("cada lección necesita título");
    if (!Number.isInteger(lesson.minutes) || lesson.minutes < 1 || lesson.minutes > 600) issues.push(`duración de «${lesson.title}» (1 a 600 minutos)`);
    if (lesson.kind === "text") {
      if (!lesson.body || lesson.body.trim() === "") issues.push(`texto de «${lesson.title}»`);
    } else if (!lesson.media) issues.push(`archivo o video de «${lesson.title}»`);
    else if (!MEDIA_SOURCES[lesson.media.source].available) issues.push(`«${lesson.title}» usa ${label("mediaSource", lesson.media.source)}, que todavía no está conectado`);
    else if (lesson.media.source === "hosted") {
      const extension = lesson.media.fileName.split(".").pop()?.toLowerCase() ?? "";
      if (!EXTENSIONS[lesson.kind].includes(extension)) issues.push(`tipo de archivo de «${lesson.title}» (${EXTENSIONS[lesson.kind].join(", ")})`);
      if (!Number.isSafeInteger(lesson.media.sizeBytes) || lesson.media.sizeBytes <= 0 || lesson.media.sizeBytes > MAX_BYTES[lesson.kind]) issues.push(`tamaño de «${lesson.title}»`);
    }
  }
  const examIds = new Set<string>();
  for (const exam of content.exams) {
    if (examIds.has(exam.id)) issues.push(`examen repetido (${exam.id})`);
    examIds.add(exam.id);
    if (exam.title.trim() === "") issues.push("cada examen necesita título");
    if (!Number.isInteger(exam.passPercent) || exam.passPercent < 50 || exam.passPercent > 100) issues.push(`nota mínima de «${exam.title}» (50 a 100)`);
    if (!Number.isInteger(exam.maxAttempts) || exam.maxAttempts < 1 || exam.maxAttempts > 10) issues.push(`intentos de «${exam.title}» (1 a 10)`);
    if (exam.timeLimitMinutes !== undefined && (!Number.isInteger(exam.timeLimitMinutes) || exam.timeLimitMinutes < 1 || exam.timeLimitMinutes > 480)) issues.push(`tiempo de «${exam.title}»`);
    if (exam.questions.length === 0) issues.push(`preguntas de «${exam.title}»`);
    for (const question of exam.questions) {
      const optionIds = question.options.map((option) => option.id);
      if (question.text.trim() === "" || question.options.length < 2 || new Set(optionIds).size !== optionIds.length) issues.push(`pregunta «${question.text || question.id}» (texto y 2 o más opciones distintas)`);
      else if (question.correct.length === 0 || !question.correct.every((id) => optionIds.includes(id))) issues.push(`respuesta correcta de «${question.text}»`);
      else if (question.kind !== "multiple" && question.correct.length !== 1) issues.push(`«${question.text}» admite una sola respuesta`);
      if (!Number.isInteger(question.points) || question.points < 1) issues.push(`puntos de «${question.text}»`);
    }
  }
  if (content.certificate.enabled && !content.exams.some((exam) => exam.required) && content.lessons.filter((lesson) => lesson.required).length === 0) issues.push("el certificado necesita lecciones u exámenes obligatorios");
  if (!Number.isInteger(content.tutor.dailyLimit) || content.tutor.dailyLimit < 1 || content.tutor.dailyLimit > TUTOR_MAX_DAILY_LIMIT) issues.push(`límite diario del tutor (1 a ${TUTOR_MAX_DAILY_LIMIT})`);
  if (content.sale) {
    if (!isCurrency(content.sale.currency) || isCrypto(content.sale.currency)) issues.push("moneda de venta");
    if (content.sale.pricing.model !== "free" && (!Number.isSafeInteger(content.sale.pricing.amountMinor) || content.sale.pricing.amountMinor <= 0)) issues.push("precio de venta positivo");
  }
  return issues;
}

/** The Marketplace listing content for a course that is for sale, or null. The Marketplace reviews and approves it on its own. */
export function toMarketListing(course: Course): ListingContent | null {
  const { content } = course;
  if (course.distribution !== "marketplace" || !content.sale) return null;
  return {
    name: content.title, summary: content.summary, description: content.description || content.summary, category: "education", tags: content.tags.slice(0, 8),
    version: `${course.version}.0.0`, pricing: content.sale.pricing, currency: content.sale.currency,
    permissions: { capabilities: [], readsPersonalData: false, writesExternally: false },
  };
}

// ---------------------------------------------------------------- events
type Base = { at: string; tenantId: string; actor: string };
export type AcademyEvent =
  | (Base & { type: "course.create"; origin: CourseOrigin; distribution: CourseDistribution; content: CourseContent })
  | (Base & { type: "course.edit"; courseId: string; content: CourseContent })
  | (Base & { type: "course.publish"; courseId: string })
  | (Base & { type: "course.review"; courseId: string; approve: boolean; reason?: string })
  | (Base & { type: "course.archive"; courseId: string })
  | (Base & { type: "tutor.configure"; courseId: string; enabled: boolean; dailyLimit: number })
  | (Base & { type: "entitlement.grant"; courseId: string; learnerTenantId: string; source: Entitlement["source"]; ref: string })
  | (Base & { type: "entitlement.revoke"; entitlementId: string })
  | (Base & { type: "enroll"; courseId: string; name: string })
  | (Base & { type: "lesson.complete"; courseId: string; lessonId: string })
  | (Base & { type: "exam.start"; courseId: string; examId: string })
  | (Base & { type: "exam.submit"; courseId: string; examId: string; answers: Readonly<Record<string, readonly string[]>> })
  | (Base & { type: "certificate.claim"; courseId: string })
  | (Base & { type: "certificate.revoke"; certificateId: string; reason: string })
  | (Base & { type: "tutor.ask"; courseId: string; lessonId?: string; question: string })
  | (Base & { type: "tutor.answer"; turnId: string; answer: string; sources: readonly string[] })
  | (Base & { type: "tutor.escalate"; turnId: string })
  | (Base & { type: "tutor.reply"; turnId: string; answer: string });

export type AcademyResult = { state: AcademyState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed: records, logs and the audit trail all stay. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: AcademyState, prefix: string): { id: string; state: AcademyState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, "0")}`, state: { ...state, sequence } };
};
const note = (state: AcademyState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: AcademyLog["level"] = "info"): AcademyState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
export const isAdmin = (state: AcademyState, actor: string): boolean => isPerson(actor) && state.admins.includes(actor);
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);

const FNV = 0x811c9dc5;
const hash = (text: string): number => {
  let value = FNV;
  for (const char of text) value = Math.imul(value ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return value;
};
const group = (text: string) => hash(text).toString(36).toUpperCase().padStart(4, "0").slice(-4);
export const CERTIFICATE_CODE = /^KYN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const enrollmentOf = (state: AcademyState, tenantId: string, userId: string, courseId: string) =>
  state.enrollments.find((item) => item.tenantId === tenantId && item.userId === userId && item.courseId === courseId);

/** Who may open a course: the owner's team for its own courses, everyone for official ones, entitled companies for sold ones. */
export function hasAccess(state: AcademyState, course: Course, tenantId: string): boolean {
  if (course.origin === "official") return course.status === "published";
  if (course.ownerTenantId === tenantId) return course.status !== "draft" && course.status !== "pendingReview";
  return course.status === "published" && course.distribution === "marketplace" && state.entitlements.some((item) => item.courseId === course.id && item.tenantId === tenantId && item.status === "active");
}

const requiredLessonIds = (content: CourseContent) => content.lessons.filter((lesson) => lesson.required).map((lesson) => lesson.id);

export function progressOf(course: Course, enrollment: Enrollment): { percent: number; done: number; total: number; minutesLeft: number } {
  const wanted = requiredLessonIds(course.content);
  const scope = wanted.length > 0 ? wanted : course.content.lessons.map((lesson) => lesson.id);
  const done = scope.filter((id) => enrollment.completed.includes(id)).length;
  const minutesLeft = course.content.lessons.filter((lesson) => scope.includes(lesson.id) && !enrollment.completed.includes(lesson.id)).reduce((sum, lesson) => sum + lesson.minutes, 0);
  return { percent: scope.length === 0 ? 0 : Math.round((done / scope.length) * 100), done, total: scope.length, minutesLeft };
}

export const attemptsOf = (state: AcademyState, tenantId: string, userId: string, courseId: string, examId: string) =>
  state.attempts.filter((attempt) => attempt.tenantId === tenantId && attempt.userId === userId && attempt.courseId === courseId && attempt.examId === examId);
export const bestScore = (attempts: readonly Attempt[]): number | null => {
  const scores = attempts.filter((attempt) => attempt.status === "graded" && attempt.scorePercent !== undefined).map((attempt) => attempt.scorePercent as number);
  return scores.length === 0 ? null : Math.max(...scores);
};

/** What is still missing for a certificate (empty when the learner qualifies). Decided by rule, never by a model. */
export function certificateGaps(state: AcademyState, course: Course, enrollment: Enrollment): string[] {
  const gaps: string[] = [];
  const missing = requiredLessonIds(course.content).filter((id) => !enrollment.completed.includes(id));
  if (missing.length) gaps.push(`${missing.length} lecciones obligatorias`);
  for (const exam of course.content.exams.filter((item) => item.required)) {
    const best = bestScore(attemptsOf(state, enrollment.tenantId, enrollment.userId, course.id, exam.id));
    if (best === null || best < exam.passPercent) gaps.push(`aprobar «${exam.title}»`);
  }
  return gaps;
}

/** Grades an exam. Only closed questions, all-or-nothing per question, exactly as the instructor defined them. */
export function gradeExam(exam: Exam, answers: Readonly<Record<string, readonly string[]>>): { scorePercent: number; passed: boolean; wrong: string[] } | null {
  let earned = 0;
  let total = 0;
  const wrong: string[] = [];
  for (const question of exam.questions) {
    total += question.points;
    const given = answers[question.id] ?? [];
    const valid = question.options.map((option) => option.id);
    if (!given.every((id) => valid.includes(id))) return null; // an answer outside the options is a malformed submission, not a wrong answer
    const exact = given.length === question.correct.length && question.correct.every((id) => given.includes(id));
    if (exact) earned += question.points;
    else wrong.push(question.id);
  }
  const scorePercent = total === 0 ? 0 : Math.round((earned / total) * 100);
  return { scorePercent, passed: scorePercent >= exam.passPercent, wrong };
}

// ---------------------------------------------------------------- the reducer
export function reduceAcademy(state: AcademyState, event: AcademyEvent): AcademyResult {
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): AcademyResult => ({ state, error: message(code, params), errorCode: code });
  const person = isPerson(event.actor);
  const course = "courseId" in event ? state.courses.find((item) => item.id === event.courseId) : undefined;
  const isOwnerTeam = (target: Course) => target.ownerTenantId === event.tenantId;
  const canManage = (target: Course) => (target.origin === "official" ? isAdmin(state, event.actor) : isOwnerTeam(target));
  const touch = (updated: Course): readonly Course[] => replace(state.courses, updated);

  switch (event.type) {
    // ---- authoring: NEX may prepare a draft (Level 1); a person publishes
    case "course.create": {
      if (!person && !isWorker(event.actor)) return refuse("personRequired");
      if (event.origin === "official" && !isAdmin(state, event.actor) && !isWorker(event.actor)) return refuse("officialOnlyAdmin");
      if (event.origin === "official" && isWorker(event.actor)) return refuse("officialOnlyAdmin");
      const created = nextId(state, "co");
      const entry: Course = { id: created.id, ownerTenantId: event.tenantId, origin: event.origin, distribution: event.origin === "official" ? "internal" : event.distribution, status: "draft", version: 1, content: event.content, createdBy: event.actor, createdAt: event.at, review: [] };
      return { state: note({ ...created.state, courses: append(created.state.courses, entry) }, event, "course.create", `${entry.id} · ${event.origin}`) };
    }

    case "course.edit": {
      if (!course) return refuse("courseNotFound");
      if (!canManage(course)) return refuse(course.origin === "official" ? "officialOnlyAdmin" : "notYours");
      if (course.status === "pendingReview") return refuse("notEditable", { status: label("courseStatus", course.status) });
      if (course.status === "archived") return refuse("notEditable", { status: label("courseStatus", course.status) });
      if (course.status === "draft") {
        if (!person && !isWorker(event.actor)) return refuse("personRequired");
        return { state: note({ ...state, courses: touch({ ...course, content: event.content }) }, event, "course.edit", course.id) };
      }
      if (!person) return refuse("personRequired"); // changing something already published is a person's decision
      const issues = courseIssues(event.content);
      if (issues.length) return refuse("courseInvalid", { detail: issues[0] });
      if (course.origin === "official") {
        const revised: Course = { ...course, pendingRevision: { content: event.content, submittedBy: event.actor, submittedAt: event.at }, review: append(course.review, { at: event.at, actor: event.actor, action: "revisionSubmitted" }) };
        return { state: note({ ...state, courses: touch(revised) }, event, "course.revision", course.id) };
      }
      return { state: note({ ...state, courses: touch({ ...course, content: event.content, version: course.version + 1 }) }, event, "course.edit", `${course.id} · v${course.version + 1}`) };
    }

    case "course.publish": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      if (!canManage(course)) return refuse(course.origin === "official" ? "officialOnlyAdmin" : "notYours");
      if (course.status !== "draft") return refuse("invalidTransition", { from: label("courseStatus", course.status), to: label("courseStatus", "published") });
      const issues = courseIssues(course.content);
      if (issues.length) return refuse("courseInvalid", { detail: issues[0] });
      const status: CourseStatus = course.origin === "official" ? "pendingReview" : "published"; // official courses carry KYNOVA's name: a second administrator approves
      const updated: Course = { ...course, status, submittedBy: event.actor, publishedAt: status === "published" ? event.at : undefined, review: append(course.review, { at: event.at, actor: event.actor, action: status === "published" ? "approved" : "submitted" }) };
      return { state: note({ ...state, courses: touch(updated) }, event, status === "published" ? "course.publish" : "course.submit", course.id) };
    }

    case "course.review": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      if (!course) return refuse("courseNotFound");
      const revision = course.status === "published" ? course.pendingRevision : undefined;
      if (course.status !== "pendingReview" && !revision) return refuse("nothingToReview");
      const submitter = revision ? revision.submittedBy : course.submittedBy;
      if (submitter === event.actor) return refuse("selfReview");
      const reason = event.reason?.trim() ?? "";
      if (!event.approve && reason === "") return refuse("reasonRequired");
      if (event.approve) {
        const issues = courseIssues(revision ? revision.content : course.content);
        if (issues.length) return refuse("courseInvalid", { detail: issues[0] });
      }
      let updated: Course;
      if (revision) {
        updated = { ...course, content: event.approve ? revision.content : course.content, version: event.approve ? course.version + 1 : course.version, pendingRevision: undefined, review: append(course.review, { at: event.at, actor: event.actor, action: event.approve ? "revisionApproved" : "revisionRejected", reason: reason || undefined }) };
      } else {
        updated = { ...course, status: event.approve ? "published" : "draft", publishedAt: event.approve ? event.at : undefined, review: append(course.review, { at: event.at, actor: event.actor, action: event.approve ? "approved" : "rejected", reason: reason || undefined }) };
      }
      return { state: note({ ...state, courses: touch(updated) }, event, event.approve ? "course.approve" : "course.reject", course.id) };
    }

    case "course.archive": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      if (!canManage(course)) return refuse(course.origin === "official" ? "officialOnlyAdmin" : "notYours");
      if (course.status === "archived") return refuse("invalidTransition", { from: label("courseStatus", "archived"), to: label("courseStatus", "archived") });
      const updated: Course = { ...course, status: "archived", pendingRevision: undefined, review: append(course.review, { at: event.at, actor: event.actor, action: "archived" }) };
      return { state: note({ ...state, courses: touch(updated) }, event, "course.archive", course.id) };
    }

    // ---- the tutor switch is the owner's authorization for NEX (Level 2); only a person turns it on
    case "tutor.configure": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      if (!canManage(course)) return refuse(course.origin === "official" ? "officialOnlyAdmin" : "notYours");
      if (!Number.isInteger(event.dailyLimit) || event.dailyLimit < 1 || event.dailyLimit > TUTOR_MAX_DAILY_LIMIT) return refuse("courseInvalid", { detail: `límite diario del tutor (1 a ${TUTOR_MAX_DAILY_LIMIT})` });
      return { state: note({ ...state, courses: touch({ ...course, content: { ...course.content, tutor: { enabled: event.enabled, dailyLimit: event.dailyLimit } } }) }, event, "tutor.configure", `${course.id} · ${event.enabled ? "activado" : "apagado"}`) };
    }

    // ---- who may open a sold course: produced by the Marketplace purchase (an adapter, or the simulation)
    case "entitlement.grant": {
      if (!person && event.actor !== "system") return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      if (course.status !== "published" || course.distribution !== "marketplace") return refuse("notForSale");
      if (event.ref.trim() === "") return refuse("refRequired");
      if (state.entitlements.some((item) => item.courseId === course.id && item.tenantId === event.learnerTenantId && item.status === "active")) return refuse("entitlementExists");
      const created = nextId(state, "ent");
      const entitlement: Entitlement = { id: created.id, courseId: course.id, tenantId: event.learnerTenantId, source: event.source, ref: event.ref.trim(), status: "active", at: event.at };
      return { state: note({ ...created.state, entitlements: append(created.state.entitlements, entitlement) }, event, "entitlement.grant", `${entitlement.id} · ${event.learnerTenantId}`) };
    }

    case "entitlement.revoke": {
      if (!person && event.actor !== "system") return refuse("personRequired");
      const entitlement = state.entitlements.find((item) => item.id === event.entitlementId);
      if (!entitlement) return refuse("entitlementNotFound");
      return { state: note({ ...state, entitlements: replace(state.entitlements, { ...entitlement, status: "revoked" as const }) }, event, "entitlement.revoke", entitlement.id, "warn") };
    }

    // ---- learning
    case "enroll": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      if (course.status !== "published") return refuse("notPublished");
      if (!hasAccess(state, course, event.tenantId)) return refuse("noAccess");
      if (enrollmentOf(state, event.tenantId, event.actor, course.id)) return refuse("alreadyEnrolled");
      const created = nextId(state, "en");
      const enrollment: Enrollment = { id: created.id, courseId: course.id, tenantId: event.tenantId, userId: event.actor, name: event.name.trim() || event.actor, enrolledAt: event.at, completed: [] };
      return { state: note({ ...created.state, enrollments: append(created.state.enrollments, enrollment) }, event, "enroll", `${course.id} · ${event.actor}`) };
    }

    case "lesson.complete": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      const enrollment = enrollmentOf(state, event.tenantId, event.actor, course.id);
      if (!enrollment) return refuse("notEnrolled");
      if (!hasAccess(state, course, event.tenantId)) return refuse("noAccess");
      const index = course.content.lessons.findIndex((lesson) => lesson.id === event.lessonId);
      if (index === -1) return refuse("lessonNotFound");
      if (enrollment.completed.includes(event.lessonId)) return { state }; // completing twice changes nothing
      if (course.content.sequential && !course.content.lessons.slice(0, index).every((lesson) => enrollment.completed.includes(lesson.id))) return refuse("lessonLocked");
      return { state: note({ ...state, enrollments: replace(state.enrollments, { ...enrollment, completed: [...enrollment.completed, event.lessonId] }) }, event, "lesson.complete", `${course.id} · ${event.lessonId}`) };
    }

    case "exam.start": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      const enrollment = enrollmentOf(state, event.tenantId, event.actor, course.id);
      if (!enrollment) return refuse("notEnrolled");
      if (!hasAccess(state, course, event.tenantId)) return refuse("noAccess");
      const exam = course.content.exams.find((item) => item.id === event.examId);
      if (!exam) return refuse("examNotFound");
      if (exam.requiresCompletion && requiredLessonIds(course.content).some((id) => !enrollment.completed.includes(id))) return refuse("completeLessonsFirst");
      // an attempt left open past its time limit counts as used
      let next = state;
      for (const open of attemptsOf(state, event.tenantId, event.actor, course.id, exam.id).filter((attempt) => attempt.status === "inProgress")) {
        const expired = exam.timeLimitMinutes !== undefined && Date.parse(event.at) > Date.parse(open.startedAt) + exam.timeLimitMinutes * 60_000;
        if (!expired) return refuse("attemptInProgress");
        next = { ...next, attempts: replace(next.attempts, { ...open, status: "expired" as const, scorePercent: 0, passed: false, submittedAt: event.at }) };
      }
      if (attemptsOf(next, event.tenantId, event.actor, course.id, exam.id).length >= exam.maxAttempts) return refuse("noAttemptsLeft", { max: exam.maxAttempts });
      const created = nextId(next, "at");
      const attempt: Attempt = { id: created.id, courseId: course.id, examId: exam.id, tenantId: event.tenantId, userId: event.actor, startedAt: event.at, status: "inProgress" };
      return { state: note({ ...created.state, attempts: append(created.state.attempts, attempt) }, event, "exam.start", `${attempt.id} · ${exam.id}`) };
    }

    case "exam.submit": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      const exam = course.content.exams.find((item) => item.id === event.examId);
      if (!exam) return refuse("examNotFound");
      const open = attemptsOf(state, event.tenantId, event.actor, course.id, exam.id).find((attempt) => attempt.status === "inProgress");
      if (!open) return refuse("noAttempt");
      const late = exam.timeLimitMinutes !== undefined && Date.parse(event.at) > Date.parse(open.startedAt) + exam.timeLimitMinutes * 60_000;
      if (late) return { state: note({ ...state, attempts: replace(state.attempts, { ...open, status: "expired" as const, scorePercent: 0, passed: false, submittedAt: event.at }) }, event, "exam.expired", open.id, "warn") };
      const graded = gradeExam(exam, event.answers);
      if (!graded) return refuse("answerInvalid");
      const attempt: Attempt = { ...open, status: "graded", submittedAt: event.at, answers: event.answers, scorePercent: graded.scorePercent, passed: graded.passed, wrong: graded.wrong };
      return { state: note({ ...state, attempts: replace(state.attempts, attempt) }, event, "exam.graded", `${attempt.id} · ${graded.scorePercent} %`) };
    }

    // ---- certificates: a rule decides; a person (or the system) claims it; only a person revokes it
    case "certificate.claim": {
      if (!person && event.actor !== "system") return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      const enrollment = enrollmentOf(state, event.tenantId, event.actor, course.id);
      if (!enrollment) return refuse("notEnrolled");
      if (!course.content.certificate.enabled) return refuse("certificatesOff");
      if (state.certificates.some((item) => item.courseId === course.id && item.tenantId === event.tenantId && item.userId === event.actor && item.status === "valid")) return refuse("alreadyCertified");
      const gaps = certificateGaps(state, course, enrollment);
      if (gaps.length) return refuse("notEligible", { detail: gaps.join(", ") });
      const created = nextId(state, "ce");
      let salt = 0;
      let code = "";
      do code = `KYN-${group(`${created.id}|${course.id}|${event.tenantId}`)}-${group(`${event.actor}|${salt}`)}-${group(`${event.at}|${salt}|${created.id}`)}`; while (state.certificates.some((item) => item.code === code) && (salt += 1) < 1_000);
      const scores = course.content.exams.filter((exam) => exam.required).map((exam) => bestScore(attemptsOf(state, event.tenantId, event.actor, course.id, exam.id)) ?? 0);
      const certificate: Certificate = {
        id: created.id, code, courseId: course.id, courseTitle: course.content.title, issuerTenantId: course.ownerTenantId, tenantId: event.tenantId, userId: event.actor, holderName: enrollment.name, issuedAt: event.at,
        scorePercent: scores.length === 0 ? null : Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length), status: "valid",
      };
      return { state: note({ ...created.state, certificates: append(created.state.certificates, certificate) }, event, "certificate.issue", `${certificate.id} · ${course.id}`) };
    }

    case "certificate.revoke": {
      if (!person) return refuse("personRequired");
      const certificate = state.certificates.find((item) => item.id === event.certificateId);
      if (!certificate) return refuse("certificateNotFound");
      const owner = state.courses.find((item) => item.id === certificate.courseId);
      const allowed = owner ? (owner.origin === "official" ? isAdmin(state, event.actor) : owner.ownerTenantId === event.tenantId) : false;
      if (!allowed) return refuse(owner?.origin === "official" ? "officialOnlyAdmin" : "notYours");
      if (certificate.status === "revoked") return refuse("certificateRevoked");
      if (event.reason.trim() === "") return refuse("reasonRequired");
      return { state: note({ ...state, certificates: replace(state.certificates, { ...certificate, status: "revoked" as const, revokedReason: event.reason.trim() }) }, event, "certificate.revoke", certificate.id, "warn") };
    }

    // ---- NEX as tutor (Level 2): a learner asks; NEX answers from the course's own lessons, or the question goes to the instructor
    case "tutor.ask": {
      if (!person) return refuse("personRequired");
      if (!course) return refuse("courseNotFound");
      if (!enrollmentOf(state, event.tenantId, event.actor, course.id)) return refuse("notEnrolled");
      if (!hasAccess(state, course, event.tenantId)) return refuse("noAccess");
      if (!course.content.tutor.enabled) return refuse("tutorDisabled");
      if (state.attempts.some((attempt) => attempt.courseId === course.id && attempt.tenantId === event.tenantId && attempt.userId === event.actor && attempt.status === "inProgress")) return refuse("tutorBlockedExam"); // never help during an exam
      const today = state.tutorTurns.filter((turn) => turn.courseId === course.id && turn.tenantId === event.tenantId && turn.userId === event.actor && sameDay(turn.at, event.at)).length;
      if (today >= course.content.tutor.dailyLimit) return refuse("tutorLimit", { max: course.content.tutor.dailyLimit });
      if (event.question.trim() === "") return refuse("reasonRequired");
      const created = nextId(state, "tt");
      const turn: TutorTurn = { id: created.id, courseId: course.id, tenantId: event.tenantId, userId: event.actor, lessonId: event.lessonId, question: event.question.trim(), status: "pending", sources: [], at: event.at };
      return { state: note({ ...created.state, tutorTurns: append(created.state.tutorTurns, turn) }, event, "tutor.ask", `${turn.id} · ${course.id}`) };
    }

    case "tutor.answer": {
      if (!isWorker(event.actor)) return refuse("aiOnly");
      const turn = state.tutorTurns.find((item) => item.id === event.turnId);
      if (!turn) return refuse("turnNotFound");
      if (turn.status !== "pending") return refuse("turnResolved");
      const owner = state.courses.find((item) => item.id === turn.courseId);
      if (!owner) return refuse("courseNotFound");
      // Level 2: allowed only inside the owner's active authorization (the tutor switch) and its daily limit
      const authorization: Authorization = { action: "academy.tutorAnswer", status: owner.content.tutor.enabled ? "active" : "inactive", maxPerDay: owner.content.tutor.dailyLimit, usedToday: 0 };
      if (!decideAutonomy("academy.tutorAnswer", authorization, new Date(event.at)).allowed) return refuse("tutorDisabled");
      const grounded = event.sources.length > 0 && event.sources.every((id) => owner.content.lessons.some((lesson) => lesson.id === id && lesson.body && lesson.body.trim() !== ""));
      if (!grounded) return refuse("ungrounded");
      if (event.answer.trim() === "") return refuse("reasonRequired");
      if (event.answer.length > MAX_TUTOR_ANSWER_CHARS) return refuse("answerTooLong", { max: MAX_TUTOR_ANSWER_CHARS });
      return { state: note({ ...state, tutorTurns: replace(state.tutorTurns, { ...turn, status: "answered" as const, answer: event.answer.trim(), sources: event.sources, answeredBy: event.actor, answeredAt: event.at }) }, event, "tutor.answer", `${turn.id} · ${event.sources.join(",")}`) };
    }

    case "tutor.escalate": {
      const turn = state.tutorTurns.find((item) => item.id === event.turnId);
      if (!turn) return refuse("turnNotFound");
      const allowed = isWorker(event.actor) || (person && turn.tenantId === event.tenantId && turn.userId === event.actor);
      if (!allowed) return refuse("personRequired");
      if (turn.status !== "pending") return refuse("turnResolved");
      return { state: note({ ...state, tutorTurns: replace(state.tutorTurns, { ...turn, status: "escalated" as const }) }, event, "tutor.escalate", turn.id) };
    }

    case "tutor.reply": {
      if (!person) return refuse("personRequired");
      const turn = state.tutorTurns.find((item) => item.id === event.turnId);
      if (!turn) return refuse("turnNotFound");
      const owner = state.courses.find((item) => item.id === turn.courseId);
      if (!owner || !canManage(owner)) return refuse("notYours");
      if (turn.status === "answered" || turn.status === "instructorReplied") return refuse("turnResolved");
      if (event.answer.trim() === "" || event.answer.length > MAX_TUTOR_ANSWER_CHARS) return refuse("answerTooLong", { max: MAX_TUTOR_ANSWER_CHARS });
      return { state: note({ ...state, tutorTurns: replace(state.tutorTurns, { ...turn, status: "instructorReplied" as const, answer: event.answer.trim(), answeredBy: event.actor, answeredAt: event.at }) }, event, "tutor.reply", turn.id) };
    }
  }
}

export function applyAllAcademy(state: AcademyState, events: readonly AcademyEvent[]): { state: AcademyState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceAcademy(current, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

// ---------------------------------------------------------------- the simulated tutor (stands in for NEX until a model is connected)
const STOPWORDS = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "y", "o", "a", "en", "que", "se", "es", "por", "para", "con", "como", "cual", "cuales", "qué", "cómo", "cuál", "me", "mi", "su", "lo", "si", "no", "mas", "más", "puedo", "puede", "hay"]);
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (text: string): string[] => fold(text).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOPWORDS.has(word));

/**
 * Deterministic stand-in for the tutor: it only ever quotes the course's own lessons. When nothing in the material
 * matches, it returns null and the question goes to the instructor, which is what a grounded tutor must do.
 */
export function simulateTutorAnswer(course: Course, question: string, lessonId?: string): { answer: string; sources: string[] } | null {
  const wanted = new Set(words(question));
  if (wanted.size === 0) return null;
  let best: { lesson: CourseLesson; sentence: string; score: number } | null = null;
  for (const lesson of course.content.lessons) {
    if (!lesson.body || (lessonId && lesson.id !== lessonId)) continue;
    for (const sentence of lesson.body.split(/(?<=[.!?])\s+/)) {
      const score = words(sentence).filter((word) => wanted.has(word)).length;
      if (score >= 2 && (!best || score > best.score)) best = { lesson, sentence: sentence.trim(), score };
    }
  }
  if (!best) return null;
  return { answer: `Según la lección «${best.lesson.title}»: ${best.sentence}`, sources: [best.lesson.id] };
}

// ---------------------------------------------------------------- views
export type CatalogEntry = { course: Course; access: "owner" | "official" | "entitled" | "forSale"; enrolled: boolean };

/** Courses a company can see: its own, the official ones and the sold ones (open if entitled, otherwise marked for sale). */
export function catalogFor(state: AcademyState, tenantId: string, userId: string, query: { text?: string; language?: CourseLanguage; origin?: CourseOrigin } = {}): CatalogEntry[] {
  const tokens = words(query.text ?? "");
  const entries: CatalogEntry[] = [];
  for (const course of state.courses) {
    if (course.status !== "published") continue;
    let access: CatalogEntry["access"];
    if (course.origin === "official") access = "official";
    else if (course.ownerTenantId === tenantId) access = "owner";
    else if (course.distribution === "marketplace") access = hasAccess(state, course, tenantId) ? "entitled" : "forSale";
    else continue; // another company's internal course is invisible
    if (query.language && course.content.language !== query.language) continue;
    if (query.origin && course.origin !== query.origin) continue;
    const haystack = new Set(words(`${course.content.title} ${course.content.summary} ${course.content.tags.join(" ")}`));
    if (tokens.some((token) => ![...haystack].some((word) => word.startsWith(token)))) continue;
    entries.push({ course, access, enrolled: Boolean(enrollmentOf(state, tenantId, userId, course.id)) });
  }
  return entries.sort((a, b) => a.course.content.title.localeCompare(b.course.content.title));
}

export type InstructorDashboard = {
  courses: Record<CourseStatus, number>;
  learners: number;
  completionRate: number | null;
  averageExamScore: number | null;
  certificates: number;
  revoked: number;
  tutor: { asked: number; answered: number; escalated: number; pending: number };
};

export function instructorDashboard(state: AcademyState, tenantId: string): InstructorDashboard {
  const mine = state.courses.filter((course) => course.ownerTenantId === tenantId);
  const ids = new Set(mine.map((course) => course.id));
  const enrollments = state.enrollments.filter((item) => ids.has(item.courseId));
  const completed = enrollments.filter((enrollment) => {
    const course = mine.find((item) => item.id === enrollment.courseId);
    return course ? progressOf(course, enrollment).percent === 100 : false;
  }).length;
  const scores = state.attempts.filter((attempt) => ids.has(attempt.courseId) && attempt.status === "graded").map((attempt) => attempt.scorePercent ?? 0);
  const turns = state.tutorTurns.filter((turn) => ids.has(turn.courseId));
  const count = (status: CourseStatus) => mine.filter((course) => course.status === status).length;
  return {
    courses: { draft: count("draft"), pendingReview: count("pendingReview"), published: count("published"), archived: count("archived") },
    learners: new Set(enrollments.map((item) => `${item.tenantId}|${item.userId}`)).size,
    completionRate: enrollments.length === 0 ? null : completed / enrollments.length,
    averageExamScore: scores.length === 0 ? null : Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
    certificates: state.certificates.filter((item) => ids.has(item.courseId) && item.status === "valid").length,
    revoked: state.certificates.filter((item) => ids.has(item.courseId) && item.status === "revoked").length,
    tutor: { asked: turns.length, answered: turns.filter((turn) => turn.status === "answered").length, escalated: turns.filter((turn) => turn.status === "escalated").length, pending: turns.filter((turn) => turn.status === "pending").length },
  };
}

/** Verifies a certificate by its code. Returns only what a third party needs, nothing else about the learner. */
export function verifyCertificate(state: AcademyState, code: string): { found: false } | { found: true; valid: boolean; holderName: string; courseTitle: string; issuedAt: string; issuer: string; scorePercent: number | null } {
  const certificate = state.certificates.find((item) => item.code === code.trim().toUpperCase());
  if (!certificate) return { found: false };
  return { found: true, valid: certificate.status === "valid", holderName: certificate.holderName, courseTitle: certificate.courseTitle, issuedAt: certificate.issuedAt, issuer: certificate.issuerTenantId, scorePercent: certificate.scorePercent };
}
