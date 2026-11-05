import {
  AUDIT_DIMENSIONS,
  AUDIT_VERSION,
  BUDGETS,
  DECISION_ROLES,
  DIMENSION_WEIGHTS,
  INFRASTRUCTURE_PILLARS,
  MATURITY_LEVELS,
  TIMELINES,
  type AuditAnswers,
  type AuditBand,
  type AuditDimension,
  type AuditGap,
  type AuditResult,
  type CatalogService,
  type Infrastructure,
  type MaturityLevel,
  type Qualification,
  type QualificationInput,
  type QualificationRules,
  type ServiceRecommendation,
} from "@/lib/contracts/audit";

// Deterministic engine behind the Business Audit (Business Score, infrastructure stage, needs, qualification).
// The model never scores: it only conducts the conversation and extracts closed answers (AGENTS.md §3.4).

const LEVEL_POINTS: Record<MaturityLevel, number> = { none: 0, adHoc: 1, defined: 2, optimized: 3 };
const MAX_LEVEL = 3;
// Below "defined" a dimension counts as a gap; from "defined" up, as a strength.
const GAP_BELOW = LEVEL_POINTS.defined;

export function businessScore(answers: AuditAnswers): number {
  const weighted = AUDIT_DIMENSIONS.reduce((sum, dimension) => sum + DIMENSION_WEIGHTS[dimension] * LEVEL_POINTS[answers[dimension]], 0);
  return Math.round(weighted / MAX_LEVEL);
}

export function bandOf(score: number): AuditBand {
  if (score >= 75) return "advanced";
  if (score >= 50) return "intermediate";
  if (score >= 25) return "basic";
  return "initial";
}

export function classifyInfrastructure(answers: AuditAnswers): Infrastructure {
  const solid = INFRASTRUCTURE_PILLARS.filter((pillar) => LEVEL_POINTS[answers[pillar]] >= GAP_BELOW).length;
  if (solid === 0) return "none";
  return solid >= 3 ? "established" : "partial";
}

const gapImpact = (dimension: AuditDimension, level: MaturityLevel) => DIMENSION_WEIGHTS[dimension] * (MAX_LEVEL - LEVEL_POINTS[level]);

export function auditGaps(answers: AuditAnswers): AuditGap[] {
  return AUDIT_DIMENSIONS.filter((dimension) => LEVEL_POINTS[answers[dimension]] < GAP_BELOW)
    .map((dimension) => ({ dimension, level: answers[dimension], impact: gapImpact(dimension, answers[dimension]) }))
    .sort((a, b) => b.impact - a.impact || AUDIT_DIMENSIONS.indexOf(a.dimension) - AUDIT_DIMENSIONS.indexOf(b.dimension));
}

export function runAudit(answers: AuditAnswers): AuditResult {
  const score = businessScore(answers);
  const strengths = AUDIT_DIMENSIONS.filter((dimension) => LEVEL_POINTS[answers[dimension]] >= GAP_BELOW).sort(
    (a, b) => DIMENSION_WEIGHTS[b] * LEVEL_POINTS[answers[b]] - DIMENSION_WEIGHTS[a] * LEVEL_POINTS[answers[a]] || AUDIT_DIMENSIONS.indexOf(a) - AUDIT_DIMENSIONS.indexOf(b),
  );
  return { version: AUDIT_VERSION, basis: "selfReported", score, band: bandOf(score), infrastructure: classifyInfrastructure(answers), gaps: auditGaps(answers), strengths };
}

// Ranks the tenant's own offer by the gaps it closes, only among services that fit the business's infrastructure stage.
export function recommendServices(result: AuditResult, catalog: readonly CatalogService[], max = 3): ServiceRecommendation[] {
  const impactOf = new Map(result.gaps.map((gap) => [gap.dimension, gap.impact]));
  return catalog
    .filter((service) => service.fitsInfrastructure.includes(result.infrastructure))
    .map((service) => {
      const because = service.addresses.filter((dimension) => impactOf.has(dimension)).sort((a, b) => (impactOf.get(b) ?? 0) - (impactOf.get(a) ?? 0));
      return { serviceId: service.id, score: because.reduce((sum, dimension) => sum + (impactOf.get(dimension) ?? 0), 0), because };
    })
    .filter((recommendation) => recommendation.score > 0)
    .sort((a, b) => b.score - a.score || a.serviceId.localeCompare(b.serviceId))
    .slice(0, max);
}

export const DEFAULT_QUALIFICATION_RULES: QualificationRules = {
  budget: { unknown: 0, low: 1, medium: 2, high: 3 },
  timeline: { exploring: 0, later: 1, soon: 2, now: 3 },
  decisionRole: { none: 0, influencer: 1, owner: 2 },
  contact: 1,
  hotMin: 7,
  warmMin: 4,
};

export function qualifyLead(input: QualificationInput, rules: QualificationRules = DEFAULT_QUALIFICATION_RULES): Qualification {
  const reasons: Qualification["reasons"] = [
    { factor: "budget", points: rules.budget[input.budget] },
    { factor: "timeline", points: rules.timeline[input.timeline] },
    { factor: "decisionRole", points: rules.decisionRole[input.decisionRole] },
    { factor: "contact", points: input.hasContact ? rules.contact : 0 },
  ];
  const points = reasons.reduce((sum, reason) => sum + reason.points, 0);
  return { grade: points >= rules.hotMin ? "hot" : points >= rules.warmMin ? "warm" : "cold", points, reasons };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T => typeof value === "string" && (options as readonly string[]).includes(value);

// Strict parsers for anything that crosses a boundary (API, storage, model output): unknown keys and values are rejected.
export function parseAuditAnswers(value: unknown): AuditAnswers | null {
  if (!isRecord(value) || Object.keys(value).length !== AUDIT_DIMENSIONS.length) return null;
  const parsed: Partial<AuditAnswers> = {};
  for (const dimension of AUDIT_DIMENSIONS) {
    const level = value[dimension];
    if (!oneOf(MATURITY_LEVELS, level)) return null;
    parsed[dimension] = level;
  }
  return parsed as AuditAnswers;
}

export function parseQualificationInput(value: unknown): QualificationInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 4) return null;
  const { budget, timeline, decisionRole, hasContact } = value;
  if (!oneOf(BUDGETS, budget) || !oneOf(TIMELINES, timeline) || !oneOf(DECISION_ROLES, decisionRole) || typeof hasContact !== "boolean") return null;
  return { budget, timeline, decisionRole, hasContact };
}
