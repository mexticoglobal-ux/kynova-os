"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { COURSE_LANGUAGES, MEDIA_SOURCES, type CourseContent, type CourseLanguage, type CourseLesson, type Exam, type LessonKind, type MediaSource, type Question, type QuestionKind } from "@/lib/contracts/platform/academy-center";
import { label } from "@/lib/contracts/platform/academy-messages";
import { parseMajor } from "@/lib/contracts/platform/currency";
import type { AcademyTabProps } from "./AcademyCenter";

const input = "w-full rounded-xl border border-line bg-raised px-3 py-2 text-sm";
const LETTERS = "abcdefghij";

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-ink-muted">{name}</span>
      {children}
    </label>
  );
}

// A small course builder: course data, lessons (video, PDF, file or reading) and one exam. Local state until "Crear borrador".
export function CourseBuilder({ send, admin }: Pick<AcademyTabProps, "send" | "admin">) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState<CourseLanguage>("es");
  const [origin, setOrigin] = useState<"own" | "official">("own");
  const [distribution, setDistribution] = useState<"internal" | "marketplace">("internal");
  const [price, setPrice] = useState("");
  const [sequential, setSequential] = useState(false);
  const [certificate, setCertificate] = useState(true);
  const [tutor, setTutor] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [lessons, setLessons] = useState<CourseLesson[]>([]);
  const [lTitle, setLTitle] = useState("");
  const [lKind, setLKind] = useState<LessonKind>("text");
  const [lMinutes, setLMinutes] = useState("5");
  const [lRequired, setLRequired] = useState(true);
  const [lSource, setLSource] = useState<MediaSource>("hosted");
  const [lFile, setLFile] = useState("");
  const [lSize, setLSize] = useState("10");
  const [lBody, setLBody] = useState("");

  const [examOn, setExamOn] = useState(false);
  const [examTitle, setExamTitle] = useState("Examen final");
  const [pass, setPass] = useState("70");
  const [attempts, setAttempts] = useState("3");
  const [timeLimit, setTimeLimit] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qText, setQText] = useState("");
  const [qKind, setQKind] = useState<QuestionKind>("single");
  const [qOptions, setQOptions] = useState("");
  const [qCorrect, setQCorrect] = useState("");

  const addLesson = () => {
    const minutes = Number(lMinutes);
    const media: CourseLesson["media"] =
      lKind === "text" ? undefined
        : lSource === "hosted" ? { source: "hosted", fileName: lFile.trim(), sizeBytes: Math.round(Number(lSize) * 1_000_000) }
        : lSource === "youtubePrivate" ? { source: "youtubePrivate", videoId: lFile.trim() || "pendiente" }
        : { source: "premium", assetId: lFile.trim() || "pendiente" };
    setLessons([...lessons, { id: `l${lessons.length + 1}`, title: lTitle.trim(), kind: lKind, minutes, required: lRequired, media, body: lBody.trim() || undefined }]);
    setLTitle(""); setLFile(""); setLBody("");
  };
  const addQuestion = () => {
    const options = qKind === "trueFalse" ? ["Verdadero", "Falso"] : qOptions.split("|").map((option) => option.trim()).filter(Boolean);
    const correct = qCorrect.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= options.length).map((value) => LETTERS[value - 1]);
    setQuestions([...questions, { id: `q${questions.length + 1}`, text: qText.trim(), kind: qKind, options: options.map((text, index) => ({ id: LETTERS[index], text })), correct, points: 1 }]);
    setQText(""); setQOptions(""); setQCorrect("");
  };

  const create = () => {
    const currency = "USD" as const;
    const minor = distribution === "marketplace" && price.trim() !== "" ? parseMajor(price, currency) : null;
    if (distribution === "marketplace" && price.trim() !== "" && minor === null) return setFormError("Precio inválido: solo números y dos decimales.");
    setFormError(null);
    const exams: Exam[] = examOn ? [{ id: "e1", title: examTitle, passPercent: Number(pass), maxAttempts: Number(attempts), timeLimitMinutes: timeLimit.trim() ? Number(timeLimit) : undefined, required: true, requiresCompletion: true, questions }] : [];
    const content: CourseContent = {
      title, summary, description: description || summary, language, tags: [], sequential, lessons, exams, certificate: { enabled: certificate },
      tutor: { enabled: tutor, dailyLimit: 5 }, sale: distribution === "marketplace" && minor !== null ? { pricing: minor === 0 ? { model: "free" } : { model: "oneTime", amountMinor: minor }, currency } : undefined,
    };
    send({ type: "course.create", origin, distribution, content });
  };

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">Nuevo curso</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="Título"><input aria-label="Título del curso" className={input} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field name="Resumen"><input aria-label="Resumen del curso" className={input} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
        <Field name="Idioma del curso"><select aria-label="Idioma del curso" className={input} value={language} onChange={(event) => setLanguage(event.target.value as CourseLanguage)}>{COURSE_LANGUAGES.map((code) => <option key={code} value={code}>{label("language", code)}</option>)}</select></Field>
        <Field name="Descripción"><input aria-label="Descripción del curso" className={input} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        {admin && <Field name="Tipo"><select aria-label="Tipo de curso" className={input} value={origin} onChange={(event) => setOrigin(event.target.value as "own" | "official")}><option value="own">{label("origin", "own")}</option><option value="official">{label("origin", "official")}</option></select></Field>}
        {origin === "own" && <Field name="Distribución"><select aria-label="Distribución" className={input} value={distribution} onChange={(event) => setDistribution(event.target.value as "internal" | "marketplace")}><option value="internal">{label("distribution", "internal")}</option><option value="marketplace">{label("distribution", "marketplace")}</option></select></Field>}
        {origin === "own" && distribution === "marketplace" && <Field name="Precio de venta (USD)"><input aria-label="Precio de venta" className={input} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={sequential} onChange={(event) => setSequential(event.target.checked)} /> Lecciones en orden</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={certificate} onChange={(event) => setCertificate(event.target.checked)} /> Emite certificado</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={tutor} onChange={(event) => setTutor(event.target.checked)} /> Tutor NEX activado (5 preguntas por día)</label>
      </div>

      <div className="space-y-3 rounded-2xl border border-line p-4">
        <h3 className="text-sm font-semibold">Lecciones ({lessons.length})</h3>
        {lessons.length > 0 && <ul className="space-y-1 text-sm">{lessons.map((lesson) => <li key={lesson.id}>{lesson.id} · {lesson.title} · {label("lessonKind", lesson.kind)} · {lesson.minutes} min{lesson.media ? ` · ${label("mediaSource", lesson.media.source)}` : ""}{lesson.media && !MEDIA_SOURCES[lesson.media.source].available ? " (no conectado)" : ""}</li>)}</ul>}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Título de la lección"><input aria-label="Título de la lección" className={input} value={lTitle} onChange={(event) => setLTitle(event.target.value)} /></Field>
          <Field name="Tipo"><select aria-label="Tipo de lección" className={input} value={lKind} onChange={(event) => setLKind(event.target.value as LessonKind)}>{(["text", "video", "pdf", "file"] as const).map((kind) => <option key={kind} value={kind}>{label("lessonKind", kind)}</option>)}</select></Field>
          <Field name="Minutos"><input aria-label="Minutos" className={input} inputMode="numeric" value={lMinutes} onChange={(event) => setLMinutes(event.target.value)} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={lRequired} onChange={(event) => setLRequired(event.target.checked)} /> Obligatoria</label>
          {lKind !== "text" && <Field name="Origen del archivo"><select aria-label="Origen del archivo" className={input} value={lSource} onChange={(event) => setLSource(event.target.value as MediaSource)}>{(Object.keys(MEDIA_SOURCES) as MediaSource[]).map((source) => <option key={source} value={source}>{label("mediaSource", source)}{MEDIA_SOURCES[source].available ? "" : " (no conectado)"}</option>)}</select></Field>}
          {lKind !== "text" && <Field name={lSource === "hosted" ? "Nombre del archivo" : "Identificador"}><input aria-label="Nombre del archivo" className={input} value={lFile} onChange={(event) => setLFile(event.target.value)} /></Field>}
          {lKind !== "text" && lSource === "hosted" && <Field name="Tamaño (MB)"><input aria-label="Tamaño en MB" className={input} inputMode="decimal" value={lSize} onChange={(event) => setLSize(event.target.value)} /></Field>}
          <Field name="Texto o transcripción (lo que NEX puede citar)"><input aria-label="Texto de la lección" className={input} value={lBody} onChange={(event) => setLBody(event.target.value)} /></Field>
        </div>
        <Button size="sm" variant="secondary" onClick={addLesson}>Agregar lección</Button>
      </div>

      <div className="space-y-3 rounded-2xl border border-line p-4">
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={examOn} onChange={(event) => setExamOn(event.target.checked)} /> Incluir un examen</label>
        {examOn && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field name="Título del examen"><input aria-label="Título del examen" className={input} value={examTitle} onChange={(event) => setExamTitle(event.target.value)} /></Field>
              <Field name="Nota mínima (%)"><input aria-label="Nota mínima" className={input} inputMode="numeric" value={pass} onChange={(event) => setPass(event.target.value)} /></Field>
              <Field name="Intentos"><input aria-label="Intentos" className={input} inputMode="numeric" value={attempts} onChange={(event) => setAttempts(event.target.value)} /></Field>
              <Field name="Tiempo límite (minutos, opcional)"><input aria-label="Tiempo límite" className={input} inputMode="numeric" value={timeLimit} onChange={(event) => setTimeLimit(event.target.value)} /></Field>
            </div>
            {questions.length > 0 && <ul className="space-y-1 text-sm">{questions.map((question) => <li key={question.id}>{question.id} · {question.text} · {label("questionKind", question.kind)} · correcta: {question.correct.join(", ")}</li>)}</ul>}
            <div className="grid gap-3 sm:grid-cols-4">
              <Field name="Pregunta"><input aria-label="Pregunta" className={input} value={qText} onChange={(event) => setQText(event.target.value)} /></Field>
              <Field name="Tipo"><select aria-label="Tipo de pregunta" className={input} value={qKind} onChange={(event) => setQKind(event.target.value as QuestionKind)}>{(["single", "multiple", "trueFalse"] as const).map((kind) => <option key={kind} value={kind}>{label("questionKind", kind)}</option>)}</select></Field>
              {qKind !== "trueFalse" && <Field name="Opciones (separadas por |)"><input aria-label="Opciones" className={input} value={qOptions} onChange={(event) => setQOptions(event.target.value)} /></Field>}
              <Field name="Correctas (números, p. ej. 2 o 1,3)"><input aria-label="Correctas" className={input} value={qCorrect} onChange={(event) => setQCorrect(event.target.value)} /></Field>
            </div>
            <Button size="sm" variant="secondary" onClick={addQuestion}>Agregar pregunta</Button>
          </>
        )}
      </div>

      {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={create}>Crear borrador</Button>
        <Badge>Al publicar se revisan los requisitos; un curso oficial lo aprueba otra persona de la administración.</Badge>
      </div>
    </Card>
  );
}
