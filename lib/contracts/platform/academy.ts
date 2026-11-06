// Academy contracts: courses, progress and certificates. Entitlements come from the plan or a marketplace purchase.

export type Lesson = { id: string; title: string; minutes: number; required: boolean };
export type Quiz = { id: string; passPercent: number };
export type Course = { id: string; title: string; summary: string; level: "beginner" | "intermediate" | "advanced"; lessons: readonly Lesson[]; quiz?: Quiz; audience: "owner" | "team" | "everyone" };

export type Progress = { completedLessonIds: readonly string[]; quizScorePercent?: number };

export function progressOf(course: Course, progress: Progress): { percent: number; completed: number; total: number; minutesLeft: number } {
  const known = new Set(course.lessons.map((lesson) => lesson.id));
  const done = new Set(progress.completedLessonIds.filter((id) => known.has(id)));
  const total = course.lessons.length;
  const minutesLeft = course.lessons.filter((lesson) => !done.has(lesson.id)).reduce((sum, lesson) => sum + lesson.minutes, 0);
  return { percent: total === 0 ? 0 : Math.round((done.size / total) * 100), completed: done.size, total, minutesLeft };
}

/** A certificate needs every required lesson and, if the course has a quiz, a passing score. */
export function eligibleForCertificate(course: Course, progress: Progress): boolean {
  const done = new Set(progress.completedLessonIds);
  if (!course.lessons.filter((lesson) => lesson.required).every((lesson) => done.has(lesson.id))) return false;
  if (!course.quiz) return true;
  return typeof progress.quizScorePercent === "number" && progress.quizScorePercent >= course.quiz.passPercent;
}

export const nextLesson = (course: Course, progress: Progress): Lesson | null => course.lessons.find((lesson) => !progress.completedLessonIds.includes(lesson.id)) ?? null;
