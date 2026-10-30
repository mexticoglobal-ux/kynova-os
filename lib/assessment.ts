import type { ModuleKey } from "@/config/site";
import {
  ASSESSMENT_QUESTIONS,
  type AssessmentAnswers,
  type AssessmentOption,
  type AssessmentQuestion,
} from "@/lib/contracts/assessment";

export type RecommendableModule = Exclude<ModuleKey, "settings">;

type Points = Partial<Record<RecommendableModule, number>>;

/** One answer that actually contributed points to a recommended module. */
export type AssessmentEvidence = {
  question: AssessmentQuestion;
  option: string;
  points: number;
};

export type AssessmentRecommendation = {
  module: RecommendableModule;
  /** Sum of the points of its evidence. */
  score: number;
  /** Only the answers that added points to this module, in question order. */
  basedOn: AssessmentEvidence[];
};

export const MIN_RECOMMENDATIONS = 2;
export const MAX_RECOMMENDATIONS = 3;
/** The third module is shown only when its evidence adds up to at least this many points. */
export const MIN_THIRD_SCORE = 3;

// A sector answer can name the module that is that sector's own, which is then always recommended.
const SECTOR_MODULE: Partial<Record<AssessmentOption<"sector">, RecommendableModule>> = {
  realEstate: "properties",
};

// Deterministic rules: each answer adds points to modules. No data beyond the user's own answers is used.
export const ASSESSMENT_RULES: { [Q in AssessmentQuestion]: Record<AssessmentOption<Q>, Points> } = {
  sector: {
    realEstate: { properties: 3, sales: 1 },
    marketingAgency: { marketing: 2, clients: 1 },
    professionalServices: { clients: 1, finance: 1 },
    // Digital product: usage and growth metrics, and online acquisition.
    software: { analytics: 2, marketing: 1 },
    retail: { sales: 2 },
    other: {},
  },
  teamSize: {
    solo: { automation: 1 },
    small: {},
    medium: { automation: 1, analytics: 1 },
    large: { analytics: 2, automation: 1 },
  },
  channel: {
    web: { marketing: 1, analytics: 1 },
    social: { marketing: 2 },
    referrals: { clients: 2 },
    ads: { marketing: 2, analytics: 1 },
    inPerson: { sales: 2 },
  },
  crm: {
    none: { clients: 2, sales: 1 },
    spreadsheets: { clients: 2, automation: 1 },
    basicTool: { sales: 1 },
    fullCrm: { automation: 1, analytics: 1 },
  },
  problem: {
    leads: { marketing: 3, sales: 1 },
    followUp: { sales: 3, clients: 2 },
    cash: { finance: 3 },
    manualWork: { automation: 3 },
    visibility: { analytics: 3 },
  },
  goal: {
    moreSales: { sales: 2, marketing: 1 },
    organizeClients: { clients: 2 },
    automate: { automation: 2 },
    controlFinances: { finance: 2 },
    understandData: { analytics: 2 },
  },
};

function pointsFor<Q extends AssessmentQuestion>(question: Q, answers: AssessmentAnswers): Points {
  return ASSESSMENT_RULES[question][answers[question]];
}

// FNV-1a: a stable 32-bit hash, so the same answers always break a tie the same way on any platform.
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

const strongestPoints = (item: AssessmentRecommendation) => Math.max(...item.basedOn.map((evidence) => evidence.points));

/**
 * Every module with evidence, best first. Ties are broken by (1) how many answers support the module,
 * (2) its strongest single answer and (3) a hash of the answers. The fixed menu order is never used,
 * so no module wins ties systematically, and the same answers always give the same ranking.
 */
export function rankModules(answers: AssessmentAnswers): AssessmentRecommendation[] {
  const byModule = new Map<RecommendableModule, AssessmentRecommendation>();

  for (const question of ASSESSMENT_QUESTIONS) {
    for (const [module, points] of Object.entries(pointsFor(question, answers)) as Array<[RecommendableModule, number]>) {
      const entry = byModule.get(module) ?? { module, score: 0, basedOn: [] };
      entry.score += points;
      entry.basedOn.push({ question, option: answers[question], points });
      byModule.set(module, entry);
    }
  }

  const answersKey = ASSESSMENT_QUESTIONS.map((question) => answers[question]).join("|");
  return [...byModule.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.basedOn.length - a.basedOn.length ||
      strongestPoints(b) - strongestPoints(a) ||
      hash(`${answersKey}:${a.module}`) - hash(`${answersKey}:${b.module}`),
  );
}

export function recommendModules(answers: AssessmentAnswers): AssessmentRecommendation[] {
  const ranked = rankModules(answers);
  const selected = ranked.filter(
    (item, index) => index < MIN_RECOMMENDATIONS || (index < MAX_RECOMMENDATIONS && item.score >= MIN_THIRD_SCORE),
  );

  const pinned = SECTOR_MODULE[answers.sector];
  const pinnedItem = pinned ? ranked.find((item) => item.module === pinned) : undefined;
  if (pinnedItem && !selected.includes(pinnedItem)) {
    if (selected.length >= MAX_RECOMMENDATIONS) selected.pop();
    selected.push(pinnedItem);
    selected.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  }

  return selected;
}
