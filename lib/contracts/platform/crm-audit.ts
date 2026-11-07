// How a Business Audit feeds the CRM. The audit itself (its questions and its module recommendations) is lib/assessment.ts and is not
// duplicated here: this file only turns the same closed answers into a 0-100 "fit" for the prospect and reuses that engine's ranking.

import { rankModules } from "../../assessment";
import { ASSESSMENT_QUESTIONS, type AssessmentAnswers } from "../assessment";

// Points for how well a prospect's answers match what the platform solves; the maximum of each question sums to MAX_POINTS.
const POINTS: { [Q in keyof AssessmentAnswers]: Record<string, number> } = {
  sector: { realEstate: 12, marketingAgency: 8, professionalServices: 12, software: 10, retail: 10, other: 6 },
  teamSize: { solo: 8, small: 14, medium: 18, large: 12 },
  channel: { web: 12, social: 10, referrals: 8, ads: 12, inPerson: 6 },
  crm: { none: 20, spreadsheets: 18, basicTool: 10, fullCrm: 4 },
  problem: { leads: 20, followUp: 22, cash: 10, manualWork: 18, visibility: 12 },
  goal: { moreSales: 25, automate: 22, organizeClients: 18, controlFinances: 12, understandData: 10 },
};
const MAX_POINTS = ASSESSMENT_QUESTIONS.reduce((total, question) => total + Math.max(...Object.values(POINTS[question])), 0);

/** 0-100: how much this prospect needs what we sell, from their own closed answers. Same answers, same number. */
export const auditFit = (answers: AssessmentAnswers): number => Math.round((ASSESSMENT_QUESTIONS.reduce((total, question) => total + (POINTS[question][answers[question]] ?? 0), 0) / MAX_POINTS) * 100);

/** The modules the existing audit engine recommends for these answers (best first). */
export const auditModules = (answers: AssessmentAnswers): string[] => rankModules(answers).slice(0, 3).map((item) => item.module);

export function isAuditAnswers(value: unknown): value is AssessmentAnswers {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ASSESSMENT_QUESTIONS.every((question) => { const answer = record[question]; return typeof answer === "string" && answer in POINTS[question]; });
}
