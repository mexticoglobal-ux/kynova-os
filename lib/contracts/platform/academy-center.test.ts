import { describe, expect, it } from "vitest";
import { ERROR_CODES, label, message } from "./academy-messages";
import {
  CERTIFICATE_CODE, COURSE_LANGUAGES, MAX_TUTOR_ANSWER_CHARS, MEDIA_SOURCES, TUTOR_MAX_DAILY_LIMIT, catalogFor, certificateGaps, courseIssues, enrollmentOf, gradeExam, hasAccess, instructorDashboard,
  newAcademyState, progressOf, reduceAcademy, simulateTutorAnswer, toMarketListing, verifyCertificate, type AcademyEvent, type AcademyState, type CourseContent,
} from "./academy-center";
import { DEMO_ADMINS, PLATFORM_TENANT, baseCourse, demoAcademyOk, exam, lesson, question } from "./academy-demo";
import { objectiveIssues } from "./marketplace-center";
import { ACTION_LEVELS, decide, levelForAction } from "./workers";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const NOVA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const VIDA = { tenantId: "tenant-vida", actor: "lucia" };
const MAR = { tenantId: "tenant-mar", actor: "marco" };
const ADMIN_A = { tenantId: PLATFORM_TENANT, actor: "admin:ana" };
const ADMIN_B = { tenantId: PLATFORM_TENANT, actor: "admin:bruno" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: PLATFORM_TENANT, actor: "system" };

const step = (state: AcademyState, event: AcademyEvent) => reduceAcademy(state, event);
const must = (state: AcademyState, event: AcademyEvent): AcademyState => {
  const result = reduceAcademy(state, event);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const fresh = () => newAcademyState(DEMO_ADMINS);
const quiz = (over = {}) => exam("e1", "Examen", [question("q1", "¿Dos más dos?", "single", [["a", "3"], ["b", "4"]], ["b"]), question("q2", "Elija los pares", "multiple", [["a", "2"], ["b", "3"], ["c", "4"]], ["a", "c"], 2)], over);
const own = (state: AcademyState, content: Partial<CourseContent> = {}, who = NOVA, distribution: "internal" | "marketplace" = "internal") => {
  const created = must(state, { ...who, at: day(1), type: "course.create", origin: "own", distribution, content: baseCourse(content) });
  return { state: created, id: created.courses.at(-1)?.id ?? "" };
};
const publishedOwn = (state: AcademyState, content: Partial<CourseContent> = {}, who = NOVA, distribution: "internal" | "marketplace" = "internal") => {
  const { state: created, id } = own(state, content, who, distribution);
  return { state: must(created, { ...who, at: day(2), type: "course.publish", courseId: id }), id };
};
const enrolled = (state: AcademyState, id: string, who = NOVA) => must(state, { ...who, at: day(3), type: "enroll", courseId: id, name: who.actor });

describe("the sample loads without a refusal and shows every state", () => {
  it("has official, own, internal, pending, NEX-drafted and unconnected-source courses", () => {
    const state = demoAcademyOk();
    expect(state.courses.map((c) => c.status).sort()).toEqual(["draft", "draft", "pendingReview", "published", "published", "published"]);
    expect(state.courses.find((c) => c.content.title.includes("borrador de NEX"))?.createdBy).toBe("worker:nex");
    expect(state.certificates).toHaveLength(1);
    expect(state.attempts.map((a) => a.passed)).toEqual([true, false]);
  });

  it("computes the instructor dashboard of each company", () => {
    const state = demoAcademyOk();
    expect(instructorDashboard(state, PLATFORM_TENANT)).toMatchObject({ courses: { published: 1, pendingReview: 1 }, learners: 2, certificates: 1, averageExamScore: 50, tutor: { asked: 2, answered: 1 } });
    expect(instructorDashboard(state, "tenant-nova").courses).toMatchObject({ draft: 2, published: 1 });
    expect(instructorDashboard(state, "tenant-unknown").learners).toBe(0);
  });
});

describe("objective review of a course", () => {
  const issues = (content: Partial<CourseContent>) => courseIssues(baseCourse(content));

  it("accepts a clean course and names what is missing otherwise", () => {
    expect(issues({})).toEqual([]);
    expect(issues({ title: " " })[0]).toContain("título");
    expect(issues({ lessons: [] })[0]).toContain("lección");
    expect(issues({ language: "xx" as never })[0]).toContain("idioma");
    expect(issues({ lessons: [lesson("l1", "A", "text", 5, true)] })[0]).toContain("texto");
    expect(issues({ lessons: [lesson("l1", "A", "text", 0, true, { body: "x" })] })[0]).toContain("duración");
    expect(issues({ lessons: [lesson("l1", "A", "text", 5, true, { body: "x" }), lesson("l1", "B", "text", 5, true, { body: "y" })] })[0]).toContain("repetida");
    expect(issues({ tutor: { enabled: true, dailyLimit: TUTOR_MAX_DAILY_LIMIT + 1 } })[0]).toContain("límite diario");
  });

  it("checks files: type whitelist (no executables), size and a media reference", () => {
    const video = (fileName: string, sizeBytes: number) => issues({ lessons: [lesson("l1", "Clase", "video", 5, true, { media: { source: "hosted", fileName, sizeBytes } })] });
    expect(video("clase.mp4", 1_000)).toEqual([]);
    expect(video("clase.exe", 1_000)[0]).toContain("tipo de archivo");
    expect(video("clase.js", 1_000)[0]).toContain("tipo de archivo");
    expect(video("clase", 1_000)[0]).toContain("tipo de archivo");
    expect(video("clase.mp4", 3_000_000_000)[0]).toContain("tamaño");
    expect(issues({ lessons: [lesson("l1", "Guía", "pdf", 5, true, { media: { source: "hosted", fileName: "guia.pdf", sizeBytes: 500 } })] })).toEqual([]);
    expect(issues({ lessons: [lesson("l1", "Guía", "pdf", 5, true, { media: { source: "hosted", fileName: "guia.zip", sizeBytes: 500 } })] })[0]).toContain("tipo de archivo");
    expect(issues({ lessons: [lesson("l1", "Guía", "pdf", 5, true)] })[0]).toContain("archivo o video");
  });

  it("declares YouTube private and premium content but will not publish with them yet", () => {
    expect(MEDIA_SOURCES.hosted.available).toBe(true);
    for (const source of ["youtubePrivate", "premium"] as const) {
      expect(MEDIA_SOURCES[source].available).toBe(false);
      expect(MEDIA_SOURCES[source].toVerify.length).toBeGreaterThan(0);
    }
    expect(issues({ lessons: [lesson("l1", "Clase", "video", 5, true, { media: { source: "youtubePrivate", videoId: "x" } })] })[0]).toContain("todavía no está conectado");
    expect(issues({ lessons: [lesson("l1", "Clase", "video", 5, true, { media: { source: "premium", assetId: "x" } })] })[0]).toContain("todavía no está conectado");
  });

  it("checks exams: pass mark, attempts, options and the correct answers", () => {
    expect(issues({ exams: [quiz()] })).toEqual([]);
    expect(issues({ exams: [quiz({ passPercent: 40 })] })[0]).toContain("nota mínima");
    expect(issues({ exams: [quiz({ maxAttempts: 0 })] })[0]).toContain("intentos");
    expect(issues({ exams: [quiz({ questions: [] })] })[0]).toContain("preguntas");
    expect(issues({ exams: [quiz({ questions: [question("q1", "¿?", "single", [["a", "x"]], ["a"])] })] })[0]).toContain("2 o más opciones");
    expect(issues({ exams: [quiz({ questions: [question("q1", "¿?", "single", [["a", "x"], ["b", "y"]], ["z"])] })] })[0]).toContain("respuesta correcta");
    expect(issues({ exams: [quiz({ questions: [question("q1", "¿?", "single", [["a", "x"], ["b", "y"]], ["a", "b"])] })] })[0]).toContain("una sola respuesta");
    expect(issues({ exams: [quiz({ timeLimitMinutes: 0 })] })[0]).toContain("tiempo");
  });

  it("checks the sale price and currency", () => {
    expect(issues({ sale: { pricing: { model: "oneTime", amountMinor: 1_000 }, currency: "USD" } })).toEqual([]);
    expect(issues({ sale: { pricing: { model: "oneTime", amountMinor: 0 }, currency: "USD" } })[0]).toContain("precio");
    expect(issues({ sale: { pricing: { model: "free" }, currency: "BTC" } })[0]).toContain("moneda");
  });
});

describe("authoring: NEX prepares, people publish, official courses need a second administrator", () => {
  it("lets NEX prepare a draft but never publish, review, archive or configure the tutor", () => {
    const { state, id } = own(fresh(), {}, NEX);
    expect(state.courses[0]).toMatchObject({ status: "draft", createdBy: "worker:nex" });
    expect(step(state, { ...NEX, at: day(2), type: "course.edit", courseId: id, content: baseCourse({ title: "Editado" }) }).error).toBeUndefined();
    for (const event of [
      { ...NEX, at: day(2), type: "course.publish", courseId: id },
      { ...NEX, at: day(2), type: "course.archive", courseId: id },
      { ...NEX, at: day(2), type: "tutor.configure", courseId: id, enabled: true, dailyLimit: 3 },
    ] as AcademyEvent[]) expect(step(state, event).errorCode).toBe("personRequired");
    expect(step(state, { ...NEX, at: day(2), type: "course.review", courseId: id, approve: true }).errorCode).toBe("personRequired");
    expect(step(state, { ...NEX, at: day(1), type: "course.create", origin: "official", distribution: "internal", content: baseCourse() }).errorCode).toBe("officialOnlyAdmin");
    expect(step(state, { tenantId: "t", actor: "system", at: day(1), type: "course.create", origin: "own", distribution: "internal", content: baseCourse() }).errorCode).toBe("personRequired");
  });

  it("publishes an own course directly when it passes the checks, and refuses one that does not", () => {
    const { state, id } = own(fresh(), { title: " " });
    expect(step(state, { ...NOVA, at: day(2), type: "course.publish", courseId: id }).errorCode).toBe("courseInvalid");
    expect(step(state, { ...VIDA, at: day(2), type: "course.publish", courseId: id }).errorCode).toBe("notYours");
    const ok = publishedOwn(fresh());
    expect(ok.state.courses[0]).toMatchObject({ status: "published", version: 1 });
    expect(step(ok.state, { ...NOVA, at: day(3), type: "course.publish", courseId: ok.id }).errorCode).toBe("invalidTransition");
  });

  it("only administrators create official courses, and a second one approves them", () => {
    expect(step(fresh(), { ...NOVA, at: day(1), type: "course.create", origin: "official", distribution: "internal", content: baseCourse() }).errorCode).toBe("officialOnlyAdmin");
    let state = must(fresh(), { ...ADMIN_A, at: day(1), type: "course.create", origin: "official", distribution: "internal", content: baseCourse({ title: "Oficial" }) });
    const id = state.courses[0].id;
    expect(step(state, { ...NOVA, at: day(2), type: "course.publish", courseId: id }).errorCode).toBe("officialOnlyAdmin");
    state = must(state, { ...ADMIN_A, at: day(2), type: "course.publish", courseId: id });
    expect(state.courses[0].status).toBe("pendingReview"); // not published by its own author
    const decide = (who: { tenantId: string; actor: string }, approve = true, reason?: string) => step(state, { ...who, at: day(3), type: "course.review", courseId: id, approve, reason });
    expect(decide(NOVA).errorCode).toBe("adminRequired");
    expect(decide({ tenantId: "x", actor: "admin:impostor" }).errorCode).toBe("adminRequired");
    expect(decide(ADMIN_A).errorCode).toBe("selfReview");
    expect(decide(ADMIN_B, false).errorCode).toBe("reasonRequired");
    expect(decide(ADMIN_B).state.courses[0].status).toBe("published");
    expect(decide(ADMIN_B, false, "Falta el examen").state.courses[0].status).toBe("draft");
    expect(step(state, { ...ADMIN_A, at: day(3), type: "course.edit", courseId: id, content: baseCourse() }).errorCode).toBe("notEditable"); // not while in review
  });

  it("sends a change to a published official course back to review, while the live version stays", () => {
    let state = must(fresh(), { ...ADMIN_A, at: day(1), type: "course.create", origin: "official", distribution: "internal", content: baseCourse({ title: "Oficial" }) });
    const id = state.courses[0].id;
    state = must(state, { ...ADMIN_A, at: day(2), type: "course.publish", courseId: id });
    state = must(state, { ...ADMIN_B, at: day(3), type: "course.review", courseId: id, approve: true });
    const edited = must(state, { ...ADMIN_B, at: day(4), type: "course.edit", courseId: id, content: baseCourse({ title: "Oficial v2" }) });
    expect(edited.courses[0].content.title).toBe("Oficial");
    expect(edited.courses[0].pendingRevision?.content.title).toBe("Oficial v2");
    expect(step(edited, { ...ADMIN_B, at: day(5), type: "course.review", courseId: id, approve: true }).errorCode).toBe("selfReview");
    const approved = must(edited, { ...ADMIN_A, at: day(5), type: "course.review", courseId: id, approve: true });
    expect(approved.courses[0]).toMatchObject({ version: 2, pendingRevision: undefined });
    expect(approved.courses[0].content.title).toBe("Oficial v2");
  });

  it("applies an edit to a published own course at once with a new version, and archives", () => {
    const { state, id } = publishedOwn(fresh());
    expect(step(state, { ...NEX, at: day(3), type: "course.edit", courseId: id, content: baseCourse() }).errorCode).toBe("personRequired");
    const edited = must(state, { ...NOVA, at: day(3), type: "course.edit", courseId: id, content: baseCourse({ title: "Nuevo título" }) });
    expect(edited.courses[0]).toMatchObject({ version: 2, content: { title: "Nuevo título" } });
    expect(step(state, { ...NOVA, at: day(3), type: "course.edit", courseId: id, content: baseCourse({ title: " " }) }).errorCode).toBe("courseInvalid");
    const archived = must(edited, { ...NOVA, at: day(4), type: "course.archive", courseId: id });
    expect(archived.courses[0].status).toBe("archived");
    expect(step(archived, { ...NOVA, at: day(5), type: "course.edit", courseId: id, content: baseCourse() }).errorCode).toBe("notEditable");
    expect(step(archived, { ...PABLO, at: day(5), type: "enroll", courseId: id, name: "x" }).errorCode).toBe("notPublished");
  });
});

describe("selling in the Marketplace", () => {
  it("builds a listing the Marketplace's own checks accept, and null when not for sale", () => {
    const sale = { pricing: { model: "oneTime", amountMinor: 4_900 } as const, currency: "USD" } as const;
    const { state, id } = publishedOwn(fresh(), { sale, tags: ["a", "b"] }, NOVA, "marketplace");
    const listing = toMarketListing(state.courses.find((c) => c.id === id) ?? state.courses[0]);
    expect(listing).toMatchObject({ category: "education", pricing: { model: "oneTime", amountMinor: 4_900 }, currency: "USD", version: "1.0.0" });
    expect(objectiveIssues("course", listing as NonNullable<typeof listing>)).toEqual([]);
    const internal = publishedOwn(fresh(), { sale });
    expect(toMarketListing(internal.state.courses[0])).toBeNull();
    expect(toMarketListing(publishedOwn(fresh(), {}, NOVA, "marketplace").state.courses[0])).toBeNull(); // no price, nothing to list
  });

  it("opens a sold course only to a company with an entitlement from a purchase, and closes it when revoked", () => {
    const sale = { pricing: { model: "oneTime", amountMinor: 1_000 } as const, currency: "USD" } as const;
    const { state, id } = publishedOwn(fresh(), { sale }, NOVA, "marketplace");
    expect(step(state, { ...VIDA, at: day(3), type: "enroll", courseId: id, name: "Lucía" }).errorCode).toBe("noAccess");
    expect(catalogFor(state, "tenant-vida", "lucia")[0].access).toBe("forSale");
    expect(step(state, { ...VIDA, at: day(3), type: "entitlement.grant", courseId: id, learnerTenantId: "tenant-vida", source: "marketplace", ref: "pu_1" }).error).toBeUndefined(); // a person may record it
    expect(step(state, { ...NEX, at: day(3), type: "entitlement.grant", courseId: id, learnerTenantId: "tenant-vida", source: "marketplace", ref: "pu_1" }).errorCode).toBe("personRequired");
    expect(step(state, { ...SYSTEM, at: day(3), type: "entitlement.grant", courseId: id, learnerTenantId: "tenant-vida", source: "marketplace", ref: " " }).errorCode).toBe("refRequired");
    const granted = must(state, { ...SYSTEM, at: day(3), type: "entitlement.grant", courseId: id, learnerTenantId: "tenant-vida", source: "marketplace", ref: "pu_1" });
    expect(step(granted, { ...SYSTEM, at: day(3), type: "entitlement.grant", courseId: id, learnerTenantId: "tenant-vida", source: "marketplace", ref: "pu_2" }).errorCode).toBe("entitlementExists");
    expect(catalogFor(granted, "tenant-vida", "lucia")[0].access).toBe("entitled");
    const learning = enrolled(granted, id, VIDA);
    const revoked = must(learning, { ...SYSTEM, at: day(4), type: "entitlement.revoke", entitlementId: granted.entitlements[0].id });
    expect(hasAccess(revoked, revoked.courses[0], "tenant-vida")).toBe(false);
    expect(step(revoked, { ...VIDA, at: day(5), type: "lesson.complete", courseId: id, lessonId: "l1" }).errorCode).toBe("noAccess");
  });

  it("does not grant access to a course that is not for sale", () => {
    const { state, id } = publishedOwn(fresh());
    expect(step(state, { ...SYSTEM, at: day(3), type: "entitlement.grant", courseId: id, learnerTenantId: "tenant-vida", source: "grant", ref: "x" }).errorCode).toBe("notForSale");
  });
});

describe("enrolling and progress", () => {
  it("keeps an internal course to its own team, opens official ones to everyone, and hides other companies' courses", () => {
    const internal = publishedOwn(fresh());
    expect(step(internal.state, { ...VIDA, at: day(3), type: "enroll", courseId: internal.id, name: "x" }).errorCode).toBe("noAccess");
    expect(catalogFor(internal.state, "tenant-vida", "lucia")).toHaveLength(0);
    expect(catalogFor(internal.state, "tenant-nova", "ana")).toHaveLength(1);
    const official = demoAcademyOk();
    expect(catalogFor(official, "tenant-mar", "marco").map((e) => e.course.content.title)).toEqual(["Atención al cliente con NEX", "KYNOVA 101: primeros pasos"]);
    expect(step(official, { ...MAR, at: day(10), type: "enroll", courseId: official.courses[0].id, name: "Marco" }).error).toBeUndefined();
  });

  it("refuses NEX, a repeat, and a course that is not published", () => {
    const { state, id } = publishedOwn(fresh());
    expect(step(state, { ...NEX, at: day(3), type: "enroll", courseId: id, name: "x" }).errorCode).toBe("personRequired");
    const once = enrolled(state, id);
    expect(step(once, { ...NOVA, at: day(4), type: "enroll", courseId: id, name: "x" }).errorCode).toBe("alreadyEnrolled");
    const draft = own(fresh());
    expect(step(draft.state, { ...NOVA, at: day(3), type: "enroll", courseId: draft.id, name: "x" }).errorCode).toBe("notPublished");
  });

  it("measures progress on the required lessons, completing twice changes nothing, and sequential courses unlock in order", () => {
    const lessons = [lesson("a", "A", "text", 10, true, { body: "x" }), lesson("b", "B", "text", 20, true, { body: "y" }), lesson("c", "C", "text", 30, false, { body: "z" })];
    const { state, id } = publishedOwn(fresh(), { lessons, sequential: true });
    let current = enrolled(state, id);
    expect(step(current, { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "b" }).errorCode).toBe("lessonLocked");
    expect(step(current, { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "zzz" }).errorCode).toBe("lessonNotFound");
    current = must(current, { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "a" });
    const again = step(current, { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "a" });
    expect(again.error).toBeUndefined();
    expect(again.state).toBe(current);
    const course = current.courses[0];
    expect(progressOf(course, enrollmentOf(current, "tenant-nova", "ana", id) ?? current.enrollments[0])).toEqual({ percent: 50, done: 1, total: 2, minutesLeft: 20 });
    current = must(current, { ...NOVA, at: day(5), type: "lesson.complete", courseId: id, lessonId: "b" });
    expect(progressOf(current.courses[0], current.enrollments[0]).percent).toBe(100); // the optional lesson does not count
    expect(step(fresh(), { ...NOVA, at: day(4), type: "lesson.complete", courseId: "nope", lessonId: "a" }).errorCode).toBe("courseNotFound");
    expect(step(state, { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "a" }).errorCode).toBe("notEnrolled");
  });
});

describe("exams are graded by code", () => {
  it("grades single, true/false and multiple answers all-or-nothing, with weights", () => {
    const e = quiz();
    expect(gradeExam(e, { q1: ["b"], q2: ["a", "c"] })).toEqual({ scorePercent: 100, passed: true, wrong: [] });
    expect(gradeExam(e, { q1: ["b"], q2: ["a"] })).toEqual({ scorePercent: 33, passed: false, wrong: ["q2"] }); // q2 is worth 2 of 3 points and needs both options
    expect(gradeExam(e, { q1: ["a"], q2: ["a", "c"] })).toEqual({ scorePercent: 67, passed: false, wrong: ["q1"] });
    expect(gradeExam(e, {})).toEqual({ scorePercent: 0, passed: false, wrong: ["q1", "q2"] });
    expect(gradeExam(e, { q1: ["zzz"] })).toBeNull();
    expect(gradeExam(quiz({ passPercent: 67 }), { q1: ["a"], q2: ["a", "c"] })?.passed).toBe(true); // the pass mark is inclusive
  });

  const course = () => publishedOwn(fresh(), { exams: [quiz({ maxAttempts: 2, timeLimitMinutes: 10 })] });

  it("needs the required lessons first, then limits attempts and keeps one open at a time", () => {
    const { state, id } = course();
    const learner = enrolled(state, id);
    expect(step(learner, { ...NOVA, at: day(4), type: "exam.start", courseId: id, examId: "e1" }).errorCode).toBe("completeLessonsFirst");
    let current = must(learner, { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "l1" });
    expect(step(current, { ...NOVA, at: day(4), type: "exam.start", courseId: id, examId: "nope" }).errorCode).toBe("examNotFound");
    expect(step(current, { ...NEX, at: day(4), type: "exam.start", courseId: id, examId: "e1" }).errorCode).toBe("personRequired");
    current = must(current, { ...NOVA, at: day(5), type: "exam.start", courseId: id, examId: "e1" });
    expect(step(current, { ...NOVA, at: day(5), type: "exam.start", courseId: id, examId: "e1" }).errorCode).toBe("attemptInProgress");
    current = must(current, { ...NOVA, at: day(5), type: "exam.submit", courseId: id, examId: "e1", answers: { q1: ["a"] } });
    current = must(current, { ...NOVA, at: day(6), type: "exam.start", courseId: id, examId: "e1" });
    current = must(current, { ...NOVA, at: day(6), type: "exam.submit", courseId: id, examId: "e1", answers: { q1: ["b"], q2: ["a", "c"] } });
    expect(step(current, { ...NOVA, at: day(7), type: "exam.start", courseId: id, examId: "e1" }).errorCode).toBe("noAttemptsLeft");
    expect(current.attempts.map((a) => [a.status, a.scorePercent, a.passed])).toEqual([["graded", 0, false], ["graded", 100, true]]);
  });

  it("refuses a submission without an attempt or with answers outside the options, and does not use up the attempt", () => {
    const { state, id } = course();
    let current = must(enrolled(state, id), { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "l1" });
    expect(step(current, { ...NOVA, at: day(5), type: "exam.submit", courseId: id, examId: "e1", answers: {} }).errorCode).toBe("noAttempt");
    current = must(current, { ...NOVA, at: day(5), type: "exam.start", courseId: id, examId: "e1" });
    expect(step(current, { ...NOVA, at: day(5), type: "exam.submit", courseId: id, examId: "e1", answers: { q1: ["zzz"] } }).errorCode).toBe("answerInvalid");
    expect(step(current, { ...NOVA, at: day(5), type: "exam.submit", courseId: id, examId: "e1", answers: { q1: ["b"] } }).error).toBeUndefined();
  });

  it("expires an attempt submitted after the time limit, which counts as used with a zero", () => {
    const { state, id } = course();
    let current = must(enrolled(state, id), { ...NOVA, at: day(4), type: "lesson.complete", courseId: id, lessonId: "l1" });
    current = must(current, { ...NOVA, at: "2026-10-05T10:00:00.000Z", type: "exam.start", courseId: id, examId: "e1" });
    const late = must(current, { ...NOVA, at: "2026-10-05T10:11:00.000Z", type: "exam.submit", courseId: id, examId: "e1", answers: { q1: ["b"], q2: ["a", "c"] } });
    expect(late.attempts[0]).toMatchObject({ status: "expired", scorePercent: 0, passed: false });
    const onTime = must(current, { ...NOVA, at: "2026-10-05T10:09:00.000Z", type: "exam.submit", courseId: id, examId: "e1", answers: { q1: ["b"], q2: ["a", "c"] } });
    expect(onTime.attempts[0].passed).toBe(true);
    // an attempt abandoned past its time is closed when the next one starts, and still counts
    const restarted = must(current, { ...NOVA, at: "2026-10-06T10:00:00.000Z", type: "exam.start", courseId: id, examId: "e1" });
    expect(restarted.attempts.map((a) => a.status)).toEqual(["expired", "inProgress"]);
    // both attempts are now used: the abandoned one expires past its limit and still counts
    expect(step(restarted, { ...NOVA, at: "2026-10-07T10:00:00.000Z", type: "exam.start", courseId: id, examId: "e1" }).errorCode).toBe("noAttemptsLeft");
  });
});

describe("certificates follow a rule, never a model", () => {
  const setup = () => {
    const { state, id } = publishedOwn(fresh(), { exams: [quiz()] });
    let current = must(enrolled(state, id), { ...PABLO, at: day(3), type: "enroll", courseId: id, name: "Pablo Mora" });
    current = must(current, { ...PABLO, at: day(4), type: "lesson.complete", courseId: id, lessonId: "l1" });
    return { state: current, id };
  };
  const pass = (state: AcademyState, id: string, who = PABLO) => {
    const started = must(state, { ...who, at: day(5), type: "exam.start", courseId: id, examId: "e1" });
    return must(started, { ...who, at: day(5), type: "exam.submit", courseId: id, examId: "e1", answers: { q1: ["b"], q2: ["a", "c"] } });
  };

  it("lists what is missing, and refuses NEX and anyone who does not qualify", () => {
    const { state, id } = setup();
    expect(certificateGaps(state, state.courses[0], state.enrollments[1])).toEqual(["aprobar «Examen»"]);
    expect(step(state, { ...PABLO, at: day(5), type: "certificate.claim", courseId: id }).errorCode).toBe("notEligible");
    expect(step(state, { ...NEX, at: day(5), type: "certificate.claim", courseId: id }).errorCode).toBe("personRequired");
    expect(step(state, { ...VIDA, at: day(5), type: "certificate.claim", courseId: id }).errorCode).toBe("notEnrolled");
    const off = publishedOwn(fresh(), { certificate: { enabled: false } });
    expect(step(enrolled(off.state, off.id), { ...NOVA, at: day(5), type: "certificate.claim", courseId: off.id }).errorCode).toBe("certificatesOff");
  });

  it("issues one verifiable certificate to a learner who qualifies, with a code that cannot be reissued", () => {
    const { state, id } = setup();
    let current = pass(state, id);
    current = must(current, { ...PABLO, at: day(6), type: "certificate.claim", courseId: id });
    const certificate = current.certificates[0];
    expect(certificate).toMatchObject({ holderName: "Pablo Mora", scorePercent: 100, status: "valid", courseTitle: "Curso de ejemplo", issuerTenantId: "tenant-nova" });
    expect(certificate.code).toMatch(CERTIFICATE_CODE);
    expect(step(current, { ...PABLO, at: day(7), type: "certificate.claim", courseId: id }).errorCode).toBe("alreadyCertified");
    expect(verifyCertificate(current, certificate.code.toLowerCase())).toMatchObject({ found: true, valid: true, holderName: "Pablo Mora" });
    expect(verifyCertificate(current, "KYN-0000-0000-0000")).toEqual({ found: false });
    expect(Object.keys(verifyCertificate(current, certificate.code)).sort()).toEqual(["courseTitle", "found", "holderName", "issuedAt", "issuer", "scorePercent", "valid"]); // nothing else about the person
  });

  it("generates unique codes for many learners", () => {
    // learners from other companies need access: make it official so anyone can enroll
    const official = must(fresh(), { ...ADMIN_A, at: day(1), type: "course.create", origin: "official", distribution: "internal", content: baseCourse({ title: "Oficial" }) });
    const oid = official.courses[0].id;
    let world = must(must(official, { ...ADMIN_A, at: day(2), type: "course.publish", courseId: oid }), { ...ADMIN_B, at: day(3), type: "course.review", courseId: oid, approve: true });
    for (let index = 0; index < 300; index += 1) {
      const who = { tenantId: `tenant-${index % 7}`, actor: `user-${index}` };
      world = must(world, { ...who, at: day(4), type: "enroll", courseId: oid, name: `Alumno ${index}` });
      world = must(world, { ...who, at: day(4), type: "lesson.complete", courseId: oid, lessonId: "l1" });
      world = must(world, { ...who, at: day(4), type: "certificate.claim", courseId: oid });
    }
    expect(new Set(world.certificates.map((c) => c.code)).size).toBe(300);
    expect(world.certificates.every((c) => CERTIFICATE_CODE.test(c.code))).toBe(true);
  });

  it("is revoked only by a person of the issuing company (or an administrator for official courses), with a reason", () => {
    const { state, id } = setup();
    const certified = must(pass(state, id), { ...PABLO, at: day(6), type: "certificate.claim", courseId: id });
    const certificateId = certified.certificates[0].id;
    expect(step(certified, { ...VIDA, at: day(7), type: "certificate.revoke", certificateId, reason: "x" }).errorCode).toBe("notYours");
    expect(step(certified, { ...NEX, at: day(7), type: "certificate.revoke", certificateId, reason: "x" }).errorCode).toBe("personRequired");
    expect(step(certified, { ...NOVA, at: day(7), type: "certificate.revoke", certificateId, reason: " " }).errorCode).toBe("reasonRequired");
    const revoked = must(certified, { ...NOVA, at: day(7), type: "certificate.revoke", certificateId, reason: "Fraude en el examen" });
    expect(verifyCertificate(revoked, revoked.certificates[0].code)).toMatchObject({ found: true, valid: false });
    expect(step(revoked, { ...NOVA, at: day(8), type: "certificate.revoke", certificateId, reason: "otra vez" }).errorCode).toBe("certificateRevoked");
    expect(step(certified, { ...NOVA, at: day(7), type: "certificate.revoke", certificateId: "nope", reason: "x" }).errorCode).toBe("certificateNotFound");
    expect(instructorDashboard(revoked, "tenant-nova")).toMatchObject({ certificates: 0, revoked: 1 });

    const demo = demoAcademyOk();
    const official = demo.certificates[0].id;
    expect(step(demo, { ...NOVA, at: day(20), type: "certificate.revoke", certificateId: official, reason: "x" }).errorCode).toBe("officialOnlyAdmin");
    expect(step(demo, { ...ADMIN_B, at: day(20), type: "certificate.revoke", certificateId: official, reason: "x" }).error).toBeUndefined();
  });

  it("can be earned again after a revocation", () => {
    const { state, id } = setup();
    let current = must(pass(state, id), { ...PABLO, at: day(6), type: "certificate.claim", courseId: id });
    current = must(current, { ...NOVA, at: day(7), type: "certificate.revoke", certificateId: current.certificates[0].id, reason: "Error" });
    current = must(current, { ...PABLO, at: day(8), type: "certificate.claim", courseId: id });
    expect(current.certificates.map((c) => c.status)).toEqual(["revoked", "valid"]);
  });
});

describe("NEX as tutor (Level 2)", () => {
  const taught = (tutor = { enabled: true, dailyLimit: 3 }) => {
    const lessons = [lesson("l1", "Aprobaciones", "text", 5, true, { body: "Quien solicita un pago no puede aprobarlo. Las acciones de Nivel 3 siempre piden confirmación." })];
    const { state, id } = publishedOwn(fresh(), { lessons, tutor, exams: [quiz({ requiresCompletion: false })] });
    return { state: enrolled(state, id, PABLO), id };
  };
  const ask = (state: AcademyState, id: string, text = "¿Quién aprueba un pago?", who = PABLO, at = day(4)) => step(state, { ...who, at, type: "tutor.ask", courseId: id, question: text });

  it("is in the catalog at Level 2, and its neighbors at the levels the Constitution sets", () => {
    expect(ACTION_LEVELS["academy.tutorAnswer"]).toBe(2);
    expect(levelForAction("academy.draftCourse")).toBe(1);
    expect(ACTION_LEVELS["academy.publishOfficial"]).toBe(3);
    expect(ACTION_LEVELS["academy.certificate"]).toBe(3);
    expect(decide("academy.certificate", { action: "academy.certificate", status: "active" }).allowed).toBe(false);
    expect(decide("academy.tutorAnswer", { action: "academy.tutorAnswer", status: "active", maxPerDay: 3 }).allowed).toBe(true); // Level 2 runs only inside an active authorization
    expect(decide("academy.tutorAnswer").allowed).toBe(false);
  });

  it("refuses a question when the tutor is off, the learner is not enrolled, or an exam is in progress", () => {
    const off = taught({ enabled: false, dailyLimit: 3 });
    expect(ask(off.state, off.id).errorCode).toBe("tutorDisabled");
    const { state, id } = taught();
    expect(ask(state, id, "x", VIDA).errorCode).toBe("notEnrolled");
    expect(ask(state, id, "x", { tenantId: "tenant-nova", actor: "worker:nex" }).errorCode).toBe("personRequired");
    const exam = must(state, { ...PABLO, at: day(4), type: "exam.start", courseId: id, examId: "e1" });
    expect(ask(exam, id).errorCode).toBe("tutorBlockedExam"); // never helps during an exam
    const done = must(exam, { ...PABLO, at: day(4), type: "exam.submit", courseId: id, examId: "e1", answers: {} });
    expect(ask(done, id).error).toBeUndefined();
  });

  it("limits questions per learner per day", () => {
    const { state, id } = taught({ enabled: true, dailyLimit: 2 });
    let current = must(state, { ...PABLO, at: day(4), type: "tutor.ask", courseId: id, question: "uno" });
    current = must(current, { ...PABLO, at: day(4), type: "tutor.ask", courseId: id, question: "dos" });
    expect(ask(current, id, "tres").errorCode).toBe("tutorLimit");
    expect(ask(current, id, "tres", PABLO, day(5)).error).toBeUndefined(); // a new day
  });

  it("is answered only by NEX, and only from lessons of the course", () => {
    const { state, id } = taught();
    const asked = must(state, { ...PABLO, at: day(4), type: "tutor.ask", courseId: id, question: "¿Quién aprueba un pago?" });
    const turnId = asked.tutorTurns[0].id;
    const answer = (who: { tenantId: string; actor: string }, text: string, sources: string[]) => step(asked, { ...who, at: day(4), type: "tutor.answer", turnId, answer: text, sources });
    expect(answer(NOVA, "Una persona", ["l1"]).errorCode).toBe("aiOnly");
    expect(answer(NEX, "Una persona", []).errorCode).toBe("ungrounded");
    expect(answer(NEX, "Una persona", ["inventada"]).errorCode).toBe("ungrounded");
    expect(answer(NEX, "x".repeat(MAX_TUTOR_ANSWER_CHARS + 1), ["l1"]).errorCode).toBe("answerTooLong");
    const ok = answer(NEX, "Una persona.", ["l1"]).state;
    expect(ok.tutorTurns[0]).toMatchObject({ status: "answered", answeredBy: "worker:nex", sources: ["l1"] });
    expect(step(ok, { ...NEX, at: day(4), type: "tutor.answer", turnId, answer: "otra", sources: ["l1"] }).errorCode).toBe("turnResolved");
    // the owner switching the tutor off withdraws the authorization, even for a question already asked
    const off = must(asked, { ...NOVA, at: day(4), type: "tutor.configure", courseId: id, enabled: false, dailyLimit: 3 });
    expect(step(off, { ...NEX, at: day(4), type: "tutor.answer", turnId, answer: "Una persona.", sources: ["l1"] }).errorCode).toBe("tutorDisabled");
  });

  it("escalates what the material cannot answer, and an instructor replies", () => {
    const { state, id } = taught();
    const asked = must(state, { ...PABLO, at: day(4), type: "tutor.ask", courseId: id, question: "¿Cuánto cuesta el plan?" });
    const turnId = asked.tutorTurns[0].id;
    const escalated = must(asked, { ...NEX, at: day(4), type: "tutor.escalate", turnId });
    expect(escalated.tutorTurns[0].status).toBe("escalated");
    expect(step(escalated, { ...VIDA, at: day(5), type: "tutor.reply", turnId, answer: "x" }).errorCode).toBe("notYours");
    expect(step(escalated, { ...NEX, at: day(5), type: "tutor.reply", turnId, answer: "x" }).errorCode).toBe("personRequired");
    const replied = must(escalated, { ...NOVA, at: day(5), type: "tutor.reply", turnId, answer: "Escríbanos para cotizar." });
    expect(replied.tutorTurns[0]).toMatchObject({ status: "instructorReplied", answeredBy: "ana" });
    expect(step(replied, { ...NOVA, at: day(6), type: "tutor.reply", turnId, answer: "otra" }).errorCode).toBe("turnResolved");
  });

  it("the simulated tutor quotes only the course's own lessons, and returns nothing when the material has no answer", () => {
    const { state } = taught();
    const course = state.courses[0];
    expect(simulateTutorAnswer(course, "¿Quién puede aprobar un pago solicitado?")).toEqual({ answer: expect.stringContaining("Quien solicita un pago no puede aprobarlo"), sources: ["l1"] });
    expect(simulateTutorAnswer(course, "¿Cuál es la capital de Francia?")).toBeNull();
    expect(simulateTutorAnswer(course, "")).toBeNull();
    expect(simulateTutorAnswer(course, "¿Quién aprueba un pago?", "otra-leccion")).toBeNull(); // scoped to a lesson
  });

  it("NEX never grades, certifies, enrolls, completes lessons or sells: the only things it can write are a draft, an answer and an escalation", () => {
    const { state, id } = taught();
    const refused: AcademyEvent[] = [
      { ...NEX, at: day(5), type: "exam.submit", courseId: id, examId: "e1", answers: {} },
      { ...NEX, at: day(5), type: "certificate.claim", courseId: id },
      { ...NEX, at: day(5), type: "lesson.complete", courseId: id, lessonId: "l1" },
      { ...NEX, at: day(5), type: "enroll", courseId: id, name: "NEX" },
      { ...NEX, at: day(5), type: "entitlement.grant", courseId: id, learnerTenantId: "tenant-vida", source: "grant", ref: "x" },
      { ...NEX, at: day(5), type: "entitlement.revoke", entitlementId: "x" },
    ];
    for (const event of refused) expect(step(state, event).errorCode, event.type).toBe("personRequired");
  });
});

describe("one company never sees another's learning data", () => {
  it("scopes enrollments, attempts, certificates and tutor turns to the company, and the dashboards too", () => {
    const state = demoAcademyOk();
    expect(enrollmentOf(state, "tenant-vida", "lucia", state.courses[0].id)?.completed).toEqual(["l1", "l2"]);
    expect(enrollmentOf(state, "tenant-nova", "lucia", state.courses[0].id)).toBeUndefined();
    expect(state.certificates.every((c) => c.tenantId === "tenant-nova")).toBe(true);
    // Vida's learner took Nova's course, but Nova's dashboard counts it and Vida's own does not
    expect(instructorDashboard(state, "tenant-nova").learners).toBe(1);
    expect(instructorDashboard(state, "tenant-vida").learners).toBe(0);
  });

  it("refuses edits, publication, tutor settings and replies on another company's course", () => {
    const { state, id } = publishedOwn(fresh());
    for (const event of [
      { ...VIDA, at: day(5), type: "course.edit", courseId: id, content: baseCourse() },
      { ...VIDA, at: day(5), type: "course.archive", courseId: id },
      { ...VIDA, at: day(5), type: "tutor.configure", courseId: id, enabled: true, dailyLimit: 3 },
    ] as AcademyEvent[]) expect(step(state, event).errorCode, event.type).toBe("notYours");
  });

  it("filters the catalog by language and text, ignoring accents", () => {
    const state = demoAcademyOk();
    expect(catalogFor(state, "tenant-vida", "lucia", { text: "atencion" }).map((e) => e.course.content.title)).toEqual(["Atención al cliente con NEX"]);
    expect(catalogFor(state, "tenant-vida", "lucia", { language: "en" })).toHaveLength(0);
    expect(catalogFor(state, "tenant-vida", "lucia", { origin: "official" })).toHaveLength(1);
    expect(catalogFor(state, "tenant-vida", "lucia").find((e) => e.course.origin === "official")?.enrolled).toBe(true);
  });
});

describe("nothing is ever trimmed", () => {
  it("keeps every enrollment, log and audit entry, however many there are", () => {
    let state = must(fresh(), { ...ADMIN_A, at: day(1), type: "course.create", origin: "official", distribution: "internal", content: baseCourse({ title: "Oficial" }) });
    const id = state.courses[0].id;
    state = must(must(state, { ...ADMIN_A, at: day(2), type: "course.publish", courseId: id }), { ...ADMIN_B, at: day(3), type: "course.review", courseId: id, approve: true });
    for (let index = 0; index < 400; index += 1) state = must(state, { tenantId: `tenant-${index}`, actor: `user-${index}`, at: day(4), type: "enroll", courseId: id, name: `A${index}` });
    expect(state.enrollments).toHaveLength(400);
    expect(state.audit.length).toBeGreaterThan(400);
    expect(state.logs.length).toBeGreaterThan(400);
    expect(state.audit[0].action).toBe("course.create");
  });
});

describe("language", () => {
  it("has a name for every course language and a message for every error code, with no placeholder left", () => {
    for (const language of COURSE_LANGUAGES) expect(label("language", language)).not.toBe("");
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b", status: "s", max: 1 })).not.toMatch(/\{\w+\}/);
    expect(message("noAttemptsLeft", { max: 3 })).toBe("Ya usó los 3 intentos de este examen.");
    expect(label("mediaState", "planned")).toContain("no conectado");
  });
});
