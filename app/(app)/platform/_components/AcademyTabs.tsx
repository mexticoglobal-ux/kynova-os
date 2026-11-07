"use client";

import { useState, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  COURSE_LANGUAGES, MEDIA_SOURCES, TUTOR_MAX_DAILY_LIMIT, bestScore, attemptsOf, catalogFor, certificateGaps, courseIssues, enrollmentOf, instructorDashboard, progressOf, simulateTutorAnswer, toMarketListing, verifyCertificate,
  type Course, type CourseLanguage, type CourseOrigin, type CourseStatus, type Exam,
} from "@/lib/contracts/platform/academy-center";
import { label } from "@/lib/contracts/platform/academy-messages";
import { formatMinor } from "@/lib/contracts/platform/currency";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import type { AcademyTabProps } from "./AcademyCenter";
import { CourseBuilder } from "./CourseBuilder";

const input = "w-full rounded-xl border border-line bg-raised px-3 py-2 text-sm";
const STATUS_TONE: Record<CourseStatus, BadgeTone> = { draft: "neutral", pendingReview: "warning", published: "success", archived: "neutral" };
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "—");

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-ink-muted">{name}</span>
      {children}
    </label>
  );
}
const Empty = ({ title, children }: { title: string; children?: string }) => <EmptyState icon={Inbox} title={title}>{children}</EmptyState>;
const AdminOnly = () => <Empty title="Solo administración">Elija una persona de la administración en «Actuar como».</Empty>;
const Progress = ({ percent }: { percent: number }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-raised-strong" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
  </div>
);

// ---------------------------------------------------------------- catalog
export function CatalogTab({ state, send, persona }: AcademyTabProps) {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<CourseLanguage | "">("");
  const [origin, setOrigin] = useState<CourseOrigin | "">("");
  const entries = catalogFor(state, persona.tenantId, persona.actor, { text, language: language || undefined, origin: origin || undefined });
  const accessLabel = { owner: "De su empresa", official: "Oficial KYNOVA", entitled: "Comprado", forSale: "A la venta" } as const;
  let simulated = state.entitlements.length;

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-5 sm:grid-cols-3">
        <Field name="Buscar"><input aria-label="Buscar" className={input} value={text} onChange={(event) => setText(event.target.value)} placeholder="atención, NEX, aprobaciones…" /></Field>
        <Field name="Idioma"><select aria-label="Idioma" className={input} value={language} onChange={(event) => setLanguage(event.target.value as CourseLanguage | "")}><option value="">Todos</option>{COURSE_LANGUAGES.map((code) => <option key={code} value={code}>{label("language", code)}</option>)}</select></Field>
        <Field name="Origen"><select aria-label="Origen" className={input} value={origin} onChange={(event) => setOrigin(event.target.value as CourseOrigin | "")}><option value="">Todos</option><option value="official">{label("origin", "official")}</option><option value="own">{label("origin", "own")}</option></select></Field>
      </Card>
      {entries.length === 0 ? <Empty title="Sin cursos">Los cursos publicados de su empresa, los oficiales y los comprados aparecen aquí.</Empty> : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map(({ course, access, enrolled }) => {
            const minutes = course.content.lessons.reduce((sum, lesson) => sum + lesson.minutes, 0);
            const listing = toMarketListing(course);
            return (
              <Card as="li" key={course.id} className="space-y-2 p-5">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={course.origin === "official" ? "accent" : "primary"}>{accessLabel[access]}</Badge>
                  <Badge>{label("language", course.content.language)}</Badge>
                  {course.content.exams.length > 0 && <Badge>Con examen</Badge>}
                  {course.content.certificate.enabled && <Badge tone="success">Certificado</Badge>}
                  {course.content.tutor.enabled && <Badge tone="accent">Tutor NEX</Badge>}
                </div>
                <h2 className="font-semibold">{course.content.title}</h2>
                <p className="text-sm text-ink-muted">{course.content.summary}</p>
                <p className="text-xs text-ink-muted">{course.content.lessons.length} lecciones · {minutes} min</p>
                {access === "forSale" && listing && <p className="text-sm font-medium">{listing.pricing.model === "free" ? "Gratis" : `${formatMinor({ amountMinor: listing.pricing.amountMinor, currency: listing.currency })}`}</p>}
                <div className="flex flex-wrap gap-2">
                  {access === "forSale" ? (
                    <Button size="sm" variant="secondary" onClick={() => { simulated += 1; send({ type: "entitlement.grant", courseId: course.id, learnerTenantId: persona.tenantId, source: "marketplace", ref: `pu_sim_${simulated}` }, "system"); }}>Simular compra en el Marketplace</Button>
                  ) : enrolled ? <Badge tone="success">Inscrito</Badge> : (
                    <Button size="sm" variant="primary" onClick={() => send({ type: "enroll", courseId: course.id, name: persona.name })}>Inscribirme</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- learning: lessons, media, exams, tutor, certificate
export function LearningTab({ state, send, persona }: AcademyTabProps) {
  const mine = state.enrollments.filter((item) => item.tenantId === persona.tenantId && item.userId === persona.actor);
  if (mine.length === 0) return <Empty title="Aún no está inscrito en ningún curso">Inscríbase desde el catálogo.</Empty>;
  return (
    <ul className="space-y-4">
      {mine.map((enrollment) => {
        const course = state.courses.find((item) => item.id === enrollment.courseId);
        return course ? <CourseLearning key={enrollment.id} course={course} state={state} send={send} persona={persona} /> : null;
      })}
    </ul>
  );
}

function CourseLearning({ course, state, send, persona }: { course: Course; state: AcademyTabProps["state"]; send: AcademyTabProps["send"]; persona: AcademyTabProps["persona"] }) {
  const enrollment = enrollmentOf(state, persona.tenantId, persona.actor, course.id);
  const [question, setQuestion] = useState("");
  if (!enrollment) return null;
  const { content } = course;
  const progress = progressOf(course, enrollment);
  const gaps = certificateGaps(state, course, enrollment);
  const certificate = state.certificates.find((item) => item.courseId === course.id && item.tenantId === persona.tenantId && item.userId === persona.actor && item.status === "valid");
  const turns = state.tutorTurns.filter((turn) => turn.courseId === course.id && turn.tenantId === persona.tenantId && turn.userId === persona.actor);

  const letNexAnswer = (turnId: string, text: string, lessonId?: string) => {
    const reply = simulateTutorAnswer(course, text, lessonId);
    if (reply) send({ type: "tutor.answer", turnId, answer: reply.answer, sources: reply.sources }, "worker:nex");
    else send({ type: "tutor.escalate", turnId }, "worker:nex"); // nothing in the material answers it: a person does
  };

  return (
    <Card as="li" className="space-y-4 p-5" aria-label={`Curso ${content.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{content.title}</h2>
        <Badge tone={course.origin === "official" ? "accent" : "primary"}>{label("origin", course.origin)}</Badge>
      </div>
      <div className="space-y-1"><Progress percent={progress.percent} /><p className="text-xs text-ink-muted">{progress.percent} % · {progress.done} de {progress.total} lecciones obligatorias{progress.minutesLeft ? ` · faltan ${progress.minutesLeft} min` : ""}</p></div>

      <ul className="space-y-2">
        {content.lessons.map((lesson, index) => {
          const done = enrollment.completed.includes(lesson.id);
          const locked = content.sequential && !content.lessons.slice(0, index).every((item) => enrollment.completed.includes(item.id));
          return (
            <li key={lesson.id} className="rounded-xl bg-raised px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{done ? "✓ " : ""}{lesson.title} <span className="text-xs text-ink-muted">· {label("lessonKind", lesson.kind)} · {lesson.minutes} min{lesson.required ? "" : " · opcional"}</span></span>
                {done ? <Badge tone="success">Completada</Badge> : <Button size="sm" variant="secondary" disabled={locked} onClick={() => send({ type: "lesson.complete", courseId: course.id, lessonId: lesson.id })}>{locked ? "Bloqueada" : "Marcar completada"}</Button>}
              </div>
              {lesson.media && <p className="text-xs text-ink-muted">{lesson.media.source === "hosted" ? `${lesson.media.fileName} · ${(lesson.media.sizeBytes / 1_000_000).toFixed(1)} MB` : `${label("mediaSource", lesson.media.source)} · ${label("mediaState", MEDIA_SOURCES[lesson.media.source].available ? "available" : "planned")}`}</p>}
              {lesson.body && <details className="text-xs text-ink-muted"><summary className="cursor-pointer">Leer</summary><p className="mt-1">{lesson.body}</p></details>}
            </li>
          );
        })}
      </ul>

      {content.exams.map((exam) => <ExamBlock key={exam.id} exam={exam} course={course} state={state} send={send} persona={persona} />)}

      {content.tutor.enabled && (
        <div className="space-y-2 rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">Tutor NEX</h3><Badge tone="accent">Nivel 2</Badge></div>
          <p className="text-xs text-ink-muted">Responde solo con lo que dicen las lecciones de este curso. Si no encuentra la respuesta, la pregunta pasa al instructor. No está disponible durante un examen y nunca califica.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input aria-label="Pregunta para el tutor" className={`${input} sm:col-span-2`} value={question} onChange={(event) => setQuestion(event.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => { if (!send({ type: "tutor.ask", courseId: course.id, question })) setQuestion(""); }}>Preguntar a NEX</Button>
          </div>
          <ul className="space-y-2 text-sm">
            {turns.map((turn) => (
              <li key={turn.id} className="rounded-xl bg-raised px-3 py-2">
                <p className="font-medium">{turn.question} <Badge>{label("tutorStatus", turn.status)}</Badge></p>
                {turn.answer && <p className="text-ink-muted">{turn.answer}</p>}
                {turn.sources.length > 0 && <p className="text-xs text-ink-muted">Fuente: {turn.sources.map((id) => content.lessons.find((lesson) => lesson.id === id)?.title ?? id).join(", ")}</p>}
                {turn.status === "pending" && <Button size="sm" variant="ghost" onClick={() => letNexAnswer(turn.id, turn.question, turn.lessonId)}>Dejar que NEX responda (simulado)</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.certificate.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line p-4 text-sm">
          {certificate ? <span>Certificado vigente: <span className="font-mono">{certificate.code}</span></span> : gaps.length === 0 ? <span>Cumple los requisitos del certificado.</span> : <span className="text-ink-muted">Para el certificado faltan: {gaps.join(", ")}.</span>}
          {!certificate && <Button size="sm" variant="primary" onClick={() => send({ type: "certificate.claim", courseId: course.id })}>Reclamar certificado</Button>}
        </div>
      )}
    </Card>
  );
}

function ExamBlock({ exam, course, state, send, persona }: { exam: Exam; course: Course; state: AcademyTabProps["state"]; send: AcademyTabProps["send"]; persona: AcademyTabProps["persona"] }) {
  const attempts = attemptsOf(state, persona.tenantId, persona.actor, course.id, exam.id);
  const open = attempts.find((attempt) => attempt.status === "inProgress");
  const best = bestScore(attempts);
  const last = [...attempts].reverse().find((attempt) => attempt.status !== "inProgress");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const toggle = (questionId: string, optionId: string, multiple: boolean) => {
    const current = answers[questionId] ?? [];
    setAnswers({ ...answers, [questionId]: multiple ? (current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]) : [optionId] });
  };
  return (
    <div className="space-y-2 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{exam.title}</h3>
        <span className="text-xs text-ink-muted">Nota mínima {exam.passPercent} % · {attempts.length} de {exam.maxAttempts} intentos{exam.timeLimitMinutes ? ` · ${exam.timeLimitMinutes} min` : ""}{best !== null ? ` · mejor nota ${best} %` : ""}</span>
      </div>
      {last && <p className="text-xs text-ink-muted">Último intento: {label("attemptStatus", last.status)} · {last.scorePercent ?? 0} % {last.passed ? "· aprobado" : "· no aprobado"}{last.wrong && last.wrong.length > 0 ? ` · preguntas falladas: ${last.wrong.join(", ")}` : ""}</p>}
      {open ? (
        <div className="space-y-3">
          {exam.questions.map((question) => (
            <fieldset key={question.id} className="space-y-1 text-sm">
              <legend className="font-medium">{question.text} <span className="text-xs text-ink-muted">({label("questionKind", question.kind)})</span></legend>
              {question.options.map((option) => (
                <label key={option.id} className="flex items-center gap-2">
                  <input type={question.kind === "multiple" ? "checkbox" : "radio"} name={`${exam.id}-${question.id}`} checked={(answers[question.id] ?? []).includes(option.id)} onChange={() => toggle(question.id, option.id, question.kind === "multiple")} />
                  {option.text}
                </label>
              ))}
            </fieldset>
          ))}
          <Button size="sm" variant="primary" onClick={() => send({ type: "exam.submit", courseId: course.id, examId: exam.id, answers })}>Enviar examen</Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => { setAnswers({}); send({ type: "exam.start", courseId: course.id, examId: exam.id }); }}>Empezar examen</Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- teaching: dashboard, builder, my courses
export function TeachTab({ state, send, persona, admin }: AcademyTabProps) {
  const dash = instructorDashboard(state, persona.tenantId);
  const mine = state.courses.filter((course) => course.ownerTenantId === persona.tenantId);
  const [reason, setReason] = useState("");
  const [tutorLimit, setTutorLimit] = useState<Record<string, string>>({});
  const [reply, setReply] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[["Cursos publicados", String(dash.courses.published)], ["Alumnos", String(dash.learners)], ["Finalización", dash.completionRate === null ? "—" : `${Math.round(dash.completionRate * 100)} %`], ["Nota media de exámenes", dash.averageExamScore === null ? "—" : `${dash.averageExamScore} %`]].map(([title, value]) => (
          <Card as="li" key={title} className="space-y-1 p-5"><h2 className="text-sm text-ink-muted">{title}</h2><p className="text-xl font-semibold">{value}</p></Card>
        ))}
      </ul>
      <Card className="flex flex-wrap gap-2 p-5">
        <Badge>{dash.courses.draft} borradores</Badge>
        <Badge tone={dash.courses.pendingReview ? "warning" : "neutral"}>{dash.courses.pendingReview} en revisión</Badge>
        <Badge tone="success">{dash.certificates} certificados vigentes</Badge>
        <Badge tone={dash.revoked ? "danger" : "neutral"}>{dash.revoked} revocados</Badge>
        <Badge>{dash.tutor.asked} preguntas al tutor</Badge>
        <Badge tone={dash.tutor.escalated ? "warning" : "neutral"}>{dash.tutor.escalated} escaladas al instructor</Badge>
      </Card>

      <CourseBuilder send={send} admin={admin} />

      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Motivo</h2>
        <input aria-label="Motivo" className={input} placeholder="Obligatorio para revocar un certificado" value={reason} onChange={(event) => setReason(event.target.value)} />
      </Card>

      {mine.length === 0 ? <Empty title="Sin cursos">Cree el primero arriba. NEX también puede dejarle un borrador para revisar.</Empty> : (
        <ul className="space-y-3">
          {[...mine].reverse().map((course) => {
            const issues = course.status === "draft" ? courseIssues(course.content) : [];
            const listing = toMarketListing(course);
            const learners = state.enrollments.filter((item) => item.courseId === course.id);
            const certs = state.certificates.filter((item) => item.courseId === course.id);
            const escalated = state.tutorTurns.filter((turn) => turn.courseId === course.id && turn.status === "escalated");
            return (
              <Card as="li" key={course.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{course.content.title} · {label("origin", course.origin)} · v{course.version}</p>
                  <div className="flex gap-1.5">{course.pendingRevision && <Badge tone="warning">Cambio en revisión</Badge>}<Badge tone={STATUS_TONE[course.status]}>{label("courseStatus", course.status)}</Badge></div>
                </div>
                <p className="text-xs text-ink-muted">Creado por {course.createdBy}{course.createdBy.startsWith("worker:") ? " (borrador preparado por NEX)" : ""} · {course.content.lessons.length} lecciones · {course.content.exams.length} exámenes · {label("language", course.content.language)}</p>
                {issues.length > 0 && <div className="flex flex-wrap gap-1.5">{issues.map((issue) => <Badge key={issue} tone="danger">Falta: {issue}</Badge>)}</div>}
                <div className="flex flex-wrap gap-2">
                  {course.status === "draft" && <Button size="sm" variant="primary" onClick={() => send({ type: "course.publish", courseId: course.id })}>{course.origin === "official" ? "Enviar a revisión" : "Publicar"}</Button>}
                  {course.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => send({ type: "course.archive", courseId: course.id })}>Archivar</Button>}
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Tutor de ${course.id}`} checked={course.content.tutor.enabled} onChange={(event) => send({ type: "tutor.configure", courseId: course.id, enabled: event.target.checked, dailyLimit: Number(tutorLimit[course.id] ?? course.content.tutor.dailyLimit) })} /> Tutor NEX</label>
                  <input aria-label={`Límite diario de ${course.id}`} className={input} inputMode="numeric" value={tutorLimit[course.id] ?? String(course.content.tutor.dailyLimit)} onChange={(event) => setTutorLimit({ ...tutorLimit, [course.id]: event.target.value })} />
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "tutor.configure", courseId: course.id, enabled: course.content.tutor.enabled, dailyLimit: Number(tutorLimit[course.id] ?? course.content.tutor.dailyLimit) })}>Guardar límite (máx. {TUTOR_MAX_DAILY_LIMIT})</Button>
                </div>
                {listing && <p className="text-xs text-ink-muted">Listo para el Marketplace: «{listing.name}» · {listing.pricing.model === "free" ? "gratis" : formatMinor({ amountMinor: listing.pricing.amountMinor, currency: listing.currency })}. El Marketplace lo revisa y lo aprueba antes de salir.</p>}
                {learners.length > 0 && <ul className="text-xs text-ink-muted">{learners.map((item) => <li key={item.id}>{item.name} ({item.tenantId}) · {progressOf(course, item).percent} %</li>)}</ul>}
                {escalated.map((turn) => (
                  <div key={turn.id} className="grid gap-2 rounded-xl bg-raised p-3 text-sm sm:grid-cols-3">
                    <p className="sm:col-span-3">Pregunta escalada: {turn.question}</p>
                    <input aria-label={`Respuesta a ${turn.id}`} className={`${input} sm:col-span-2`} value={reply[turn.id] ?? ""} onChange={(event) => setReply({ ...reply, [turn.id]: event.target.value })} />
                    <Button size="sm" variant="secondary" onClick={() => send({ type: "tutor.reply", turnId: turn.id, answer: reply[turn.id] ?? "" })}>Responder</Button>
                  </div>
                ))}
                {certs.map((certificate) => (
                  <div key={certificate.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                    <span>{certificate.holderName} · {certificate.code} · {label("certificateStatus", certificate.status)}</span>
                    {certificate.status === "valid" && <Button size="sm" variant="ghost" onClick={() => send({ type: "certificate.revoke", certificateId: certificate.id, reason })}>Revocar certificado</Button>}
                  </div>
                ))}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- official courses: review queue
export function AdminTab({ state, send, admin, tenantName }: AcademyTabProps) {
  const [reason, setReason] = useState("");
  if (!admin) return <AdminOnly />;
  const queue = state.courses.filter((course) => course.status === "pendingReview" || (course.status === "published" && course.pendingRevision));
  const official = state.courses.filter((course) => course.origin === "official");
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Cursos oficiales de KYNOVA</h2><Badge tone="danger">Nivel 3</Badge></div>
        <p className="text-sm text-ink-muted">Llevan el nombre de KYNOVA: quien los envía no puede aprobarlos, y un cambio a uno ya publicado vuelve a revisión mientras sigue visible la versión aprobada.</p>
        <input aria-label="Motivo de la decisión" className={input} placeholder="Obligatorio para rechazar" value={reason} onChange={(event) => setReason(event.target.value)} />
      </Card>
      <h2 className="font-semibold">Cola de revisión ({queue.length})</h2>
      {queue.length === 0 ? <Empty title="Cola vacía">Los cursos oficiales nuevos y sus cambios aparecen aquí.</Empty> : (
        <ul className="space-y-3">
          {queue.map((course) => {
            const content = course.pendingRevision ? course.pendingRevision.content : course.content;
            const issues = courseIssues(content);
            return (
              <Card as="li" key={course.id} className="space-y-2 p-4">
                <p className="font-medium">{content.title} · {tenantName(course.ownerTenantId)} · enviado por {course.pendingRevision?.submittedBy ?? course.submittedBy}</p>
                <div className="flex flex-wrap gap-1.5">{issues.length === 0 ? <Badge tone="success">Cumple los requisitos</Badge> : issues.map((issue) => <Badge key={issue} tone="danger">Falta: {issue}</Badge>)}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => send({ type: "course.review", courseId: course.id, approve: true })}>Aprobar curso</Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "course.review", courseId: course.id, approve: false, reason })}>Rechazar curso</Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
      <h2 className="font-semibold">Oficiales ({official.length})</h2>
      <ul className="space-y-2 text-sm">{official.map((course) => <li key={course.id}>{course.content.title} · {label("courseStatus", course.status)} · v{course.version}</li>)}</ul>
    </div>
  );
}

// ---------------------------------------------------------------- certificates: mine and public verification
export function CertificatesTab({ state, persona }: AcademyTabProps) {
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const result = checked === null ? null : verifyCertificate(state, checked);
  const mine = state.certificates.filter((item) => item.tenantId === persona.tenantId && item.userId === persona.actor);
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Verificar un certificado</h2>
        <p className="text-sm text-ink-muted">Cualquiera puede comprobar un código. Solo se muestra lo necesario: el nombre, el curso, la fecha y si sigue vigente.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="Código del certificado" className={`${input} sm:col-span-2 font-mono`} placeholder="KYN-XXXX-XXXX-XXXX" value={code} onChange={(event) => setCode(event.target.value)} />
          <Button size="sm" variant="primary" onClick={() => setChecked(code)}>Verificar</Button>
        </div>
        {result && (result.found ? (
          <p role="status" className="rounded-xl bg-raised px-3 py-2 text-sm">{result.valid ? "Certificado válido" : "Certificado revocado"}: {result.holderName} · {result.courseTitle} · {day(result.issuedAt)}{result.scorePercent !== null ? ` · nota ${result.scorePercent} %` : ""}</p>
        ) : <p role="status" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">No existe un certificado con ese código.</p>)}
      </Card>
      <h2 className="font-semibold">Mis certificados</h2>
      {mine.length === 0 ? <Empty title="Aún no tiene certificados">Se emiten al cumplir las lecciones y aprobar los exámenes obligatorios.</Empty> : (
        <ul className="space-y-2">{mine.map((certificate) => <Card as="li" key={certificate.id} className="p-4 text-sm"><p className="font-medium">{certificate.courseTitle} <Badge tone={certificate.status === "valid" ? "success" : "danger"}>{label("certificateStatus", certificate.status)}</Badge></p><p className="font-mono text-xs text-ink-muted">{certificate.code} · {day(certificate.issuedAt)}{certificate.revokedReason ? ` · ${certificate.revokedReason}` : ""}</p></Card>)}</ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- audit and logs
export function ActivityTab({ state }: AcademyTabProps) {
  const feeds = [
    { title: "Auditoría", empty: "Sin cambios", rows: state.audit.map((entry) => `${day(entry.at)} · ${entry.tenantId} · ${entry.actor} · ${entry.action}${entry.detail ? ` · ${entry.detail}` : ""}`) },
    { title: "Registros", empty: "Sin registros", rows: state.logs.map((entry) => `${entry.level.toUpperCase()} · ${entry.event}`) },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {feeds.map((feed) => {
        const { shown, hidden } = latest(feed.rows);
        return (
          <Card key={feed.title} className="space-y-2 p-5">
            <h2 className="font-semibold">{feed.title} ({feed.rows.length})</h2>
            {feed.rows.length === 0 ? <p className="text-xs text-ink-muted">{feed.empty}</p> : <ul className="max-h-96 space-y-1 overflow-auto text-xs text-ink-muted">{shown.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}</ul>}
            {hiddenNote(hidden) && <p className="text-xs text-ink-muted">{hiddenNote(hidden)}</p>}
          </Card>
        );
      })}
    </div>
  );
}
