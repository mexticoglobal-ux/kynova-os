// Sample data for the local simulation of the Academy. Fictional companies, people, courses and files. It is built by
// applying events through the same reducer a real adapter will use, so loading it also proves the rules hold together.

import {
  newAcademyState, reduceAcademy, simulateTutorAnswer,
  type AcademyEvent, type AcademyState, type CourseContent, type CourseLesson, type Exam, type Question,
} from "./academy-center";

export const PLATFORM_TENANT = "tenant-kynova";
export const DEMO_ADMINS = ["admin:ana", "admin:bruno"] as const;

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
  { id: PLATFORM_TENANT, name: "KYNOVA" },
] as const;

// Who the simulation can act as. "worker:nex" is NEX: it can prepare a course draft and answer a learner's question from the material.
export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana (instructora)", tenantId: "tenant-nova", actor: "ana", name: "Ana Rojas" },
  { id: "nova-pablo", label: "Nova · Pablo (alumno)", tenantId: "tenant-nova", actor: "pablo", name: "Pablo Mora" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía", tenantId: "tenant-vida", actor: "lucia", name: "Lucía Vargas" },
  { id: "admin-ana", label: "Administración · Ana", tenantId: PLATFORM_TENANT, actor: "admin:ana", name: "Ana (KYNOVA)" },
  { id: "admin-bruno", label: "Administración · Bruno", tenantId: PLATFORM_TENANT, actor: "admin:bruno", name: "Bruno (KYNOVA)" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex", name: "NEX" },
] as const;

export const lesson = (id: string, title: string, kind: CourseLesson["kind"], minutes: number, required: boolean, extra: Partial<CourseLesson> = {}): CourseLesson => ({ id, title, kind, minutes, required, ...extra });
export const question = (id: string, text: string, kind: Question["kind"], options: [string, string][], correct: string[], points = 1): Question => ({ id, text, kind, options: options.map(([optionId, optionText]) => ({ id: optionId, text: optionText })), correct, points });
export const exam = (id: string, title: string, questions: Question[], over: Partial<Exam> = {}): Exam => ({ id, title, passPercent: 70, maxAttempts: 3, required: true, requiresCompletion: true, questions, ...over });

export const baseCourse = (over: Partial<CourseContent> = {}): CourseContent => ({
  title: "Curso de ejemplo",
  summary: "Un resumen breve de lo que se aprende.",
  description: "Descripción completa del curso, para quién es y qué incluye.",
  language: "es",
  tags: [],
  sequential: false,
  lessons: [lesson("l1", "Introducción", "text", 5, true, { body: "Esta es la introducción del curso." })],
  exams: [],
  certificate: { enabled: true },
  tutor: { enabled: false, dailyLimit: 5 },
  ...over,
});

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;

export function demoAcademyState(): { state: AcademyState; errors: string[] } {
  const errors: string[] = [];
  let state = newAcademyState(DEMO_ADMINS);
  const send = (event: AcademyEvent) => {
    const result = reduceAcademy(state, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const course = (title: string) => state.courses.find((item) => item.content.title === title);
  const id = (title: string) => course(title)?.id ?? "";
  const nova = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const lucia = { tenantId: "tenant-vida", actor: "lucia" };
  const adminAna = { tenantId: PLATFORM_TENANT, actor: "admin:ana" };
  const adminBruno = { tenantId: PLATFORM_TENANT, actor: "admin:bruno" };

  // ---- the official course: written by one administrator, approved by the other
  const kynova101 = "KYNOVA 101: primeros pasos";
  send({ ...adminAna, at: day(1), type: "course.create", origin: "official", distribution: "internal", content: baseCourse({
    title: kynova101, summary: "Cómo trabaja KYNOVA y qué le pide NEX a una persona.", description: "El recorrido básico para su equipo: el panel, el asistente NEX y las aprobaciones.", tags: ["inicio", "nex", "aprobaciones"],
    lessons: [
      lesson("l1", "Bienvenida a KYNOVA", "video", 10, true, { media: { source: "hosted", fileName: "bienvenida.mp4", sizeBytes: 120_000_000 }, body: "KYNOVA es un sistema operativo de negocio con inteligencia artificial. NEX es el asistente que prepara el trabajo y pide aprobación antes de enviar mensajes o mover dinero. Todo lo que sale de la plataforma pasa por una persona." }),
      lesson("l2", "Guía de aprobaciones", "pdf", 8, true, { media: { source: "hosted", fileName: "guia-aprobaciones.pdf", sizeBytes: 2_000_000 }, body: "Una aprobación es la confirmación de una persona antes de una acción importante. Quien solicita un pago no puede aprobarlo. Las acciones de Nivel 3 siempre piden confirmación." }),
      lesson("l3", "Primeros pasos", "text", 5, false, { body: "Cree su empresa, invite a su equipo y revise el panel. Cada persona tiene un rol: propietario, administrador, miembro o lector." }),
    ],
    exams: [exam("e1", "Examen de KYNOVA 101", [
      question("q1", "¿Quién decide el pago de una comisión?", "single", [["a", "NEX"], ["b", "Una persona"], ["c", "El sistema"]], ["b"]),
      question("q2", "NEX puede aprobar sus propios pagos.", "trueFalse", [["t", "Verdadero"], ["f", "Falso"]], ["f"]),
      question("q3", "¿Qué requiere la aprobación de una persona?", "multiple", [["a", "Enviar un mensaje a un cliente"], ["b", "Mover dinero"], ["c", "Leer el panel"], ["d", "Publicar en el Marketplace"]], ["a", "b", "d"]),
    ])],
    tutor: { enabled: true, dailyLimit: 5 },
  }) });
  send({ ...adminAna, at: day(1), type: "course.publish", courseId: id(kynova101) });
  send({ ...adminBruno, at: day(2), type: "course.review", courseId: id(kynova101), approve: true });

  // a second official course waits for its second administrator
  send({ ...adminBruno, at: day(3), type: "course.create", origin: "official", distribution: "internal", content: baseCourse({ title: "KYNOVA 201: automatizaciones", summary: "Automatice el seguimiento sin perder el control.", tags: ["automatización"], lessons: [lesson("l1", "Qué se puede automatizar", "text", 10, true, { body: "Una automatización tiene un disparador, condiciones y acciones. Todo lo que sale de la plataforma espera la aprobación de una persona." })] }) });
  send({ ...adminBruno, at: day(3), type: "course.publish", courseId: id("KYNOVA 201: automatizaciones") });

  // ---- Nova's own course, for sale in the Marketplace
  const atencion = "Atención al cliente con NEX";
  send({ ...nova, at: day(1), type: "course.create", origin: "own", distribution: "marketplace", content: baseCourse({
    title: atencion, summary: "Responda más rápido y con el tono de su empresa.", description: "Un curso práctico con plantillas listas para su equipo de atención.", tags: ["atención", "clientes", "plantillas"], sequential: true,
    lessons: [
      lesson("n1", "Tiempos de respuesta", "video", 12, true, { media: { source: "hosted", fileName: "tiempos.mp4", sizeBytes: 150_000_000 }, body: "Responda en menos de una hora durante el horario de atención. Use el tono de la empresa y pida aprobación antes de enviar la primera respuesta a un cliente nuevo." }),
      lesson("n2", "Plantillas de respuesta", "file", 6, true, { media: { source: "hosted", fileName: "plantillas.zip", sizeBytes: 3_000_000 } }),
      lesson("n3", "Cómo manejar una queja", "text", 6, true, { body: "Las quejas se escalan a una persona. Registre cada queja en el historial del cliente para dar seguimiento." }),
    ],
    exams: [exam("e1", "Examen de atención", [
      question("q1", "¿Qué se hace con una queja?", "single", [["a", "Se ignora"], ["b", "Se escala a una persona"]], ["b"]),
      question("q2", "La primera respuesta a un cliente nuevo necesita aprobación.", "trueFalse", [["t", "Verdadero"], ["f", "Falso"]], ["t"]),
    ], { passPercent: 60, maxAttempts: 2, timeLimitMinutes: 20 })],
    tutor: { enabled: true, dailyLimit: 10 },
    sale: { pricing: { model: "oneTime", amountMinor: 4_900 }, currency: "USD" },
  }) });
  send({ ...nova, at: day(2), type: "course.publish", courseId: id(atencion) });

  // ---- Vida's internal course: only its own team
  send({ ...lucia, at: day(2), type: "course.create", origin: "own", distribution: "internal", content: baseCourse({ title: "Protocolos internos de la clínica", summary: "Cómo atendemos a cada paciente.", lessons: [lesson("p1", "Recepción", "text", 5, true, { body: "Salude al paciente por su nombre y confirme su cita." }), lesson("p2", "Higiene", "text", 5, true, { body: "Desinfecte la sala entre cada paciente." })] }) });
  send({ ...lucia, at: day(2), type: "course.publish", courseId: id("Protocolos internos de la clínica") });

  // ---- drafts: one prepared by NEX (Level 1) and one that uses a source that is not connected yet
  send({ tenantId: "tenant-nova", actor: "worker:nex", at: day(4), type: "course.create", origin: "own", distribution: "internal", content: baseCourse({ title: "Seguimiento de ventas (borrador de NEX)", summary: "Borrador preparado por NEX para que lo revise Ana.", lessons: [lesson("s1", "El seguimiento", "text", 6, true, { body: "Cada prospecto necesita una próxima acción con fecha." })] }) });
  send({ ...nova, at: day(4), type: "course.create", origin: "own", distribution: "internal", content: baseCourse({ title: "Taller en video privado", summary: "Usa YouTube privado, que todavía no está conectado.", lessons: [lesson("v1", "Clase grabada", "video", 30, true, { media: { source: "youtubePrivate", videoId: "abc123" } })] }) });

  // ---- Pablo (Nova) takes the official course and earns a certificate
  send({ ...pablo, at: day(5), type: "enroll", courseId: id(kynova101), name: "Pablo Mora" });
  send({ ...pablo, at: day(5), type: "lesson.complete", courseId: id(kynova101), lessonId: "l1" });
  send({ ...pablo, at: day(5), type: "lesson.complete", courseId: id(kynova101), lessonId: "l2" });
  send({ ...pablo, at: day(6), type: "exam.start", courseId: id(kynova101), examId: "e1" });
  send({ ...pablo, at: day(6), type: "exam.submit", courseId: id(kynova101), examId: "e1", answers: { q1: ["b"], q2: ["f"], q3: ["a", "b", "d"] } });
  send({ ...pablo, at: day(6), type: "certificate.claim", courseId: id(kynova101) });

  // ---- Lucía (Clínica Vida): partial progress, a tutor that answers from the material, a question that goes to a person, and a failed exam
  send({ ...lucia, at: day(7), type: "enroll", courseId: id(kynova101), name: "Lucía Vargas" });
  send({ ...lucia, at: day(7), type: "lesson.complete", courseId: id(kynova101), lessonId: "l1" });
  const ask = (question: string, at: number) => {
    send({ ...lucia, at: day(at), type: "tutor.ask", courseId: id(kynova101), question });
    const turn = state.tutorTurns.at(-1);
    const reply = turn ? simulateTutorAnswer(course(kynova101) ?? state.courses[0], question) : null;
    if (turn && reply) send({ tenantId: "tenant-vida", actor: "worker:nex", at: day(at), type: "tutor.answer", turnId: turn.id, answer: reply.answer, sources: reply.sources });
    else if (turn) send({ tenantId: "tenant-vida", actor: "worker:nex", at: day(at), type: "tutor.escalate", turnId: turn.id });
  };
  ask("¿Quién aprueba el pago de una comisión?", 7);
  ask("¿Cuál es el precio del plan anual?", 7); // nothing in the material: it goes to the instructor
  send({ ...adminAna, at: day(8), type: "tutor.reply", turnId: state.tutorTurns.at(-1)?.id ?? "", answer: "Los precios están en la página de planes; si necesita una cotización, escríbanos." });
  send({ ...lucia, at: day(8), type: "lesson.complete", courseId: id(kynova101), lessonId: "l2" });
  send({ ...lucia, at: day(8), type: "exam.start", courseId: id(kynova101), examId: "e1" });
  send({ ...lucia, at: day(8), type: "exam.submit", courseId: id(kynova101), examId: "e1", answers: { q1: ["a"], q2: ["t"], q3: ["c"] } });

  // ---- Lucía buys Nova's course in the Marketplace (simulated) and starts it
  send({ tenantId: PLATFORM_TENANT, actor: "system", at: day(9), type: "entitlement.grant", courseId: id(atencion), learnerTenantId: "tenant-vida", source: "marketplace", ref: "pu_0001" });
  send({ ...lucia, at: day(9), type: "enroll", courseId: id(atencion), name: "Lucía Vargas" });
  send({ ...lucia, at: day(9), type: "lesson.complete", courseId: id(atencion), lessonId: "n1" });
  return { state, errors };
}

export const demoAcademyOk = (): AcademyState => {
  const { state, errors } = demoAcademyState();
  if (errors.length) throw new Error(errors.join("; "));
  return state;
};
