// Business Audit v1: closed maturity levels per dimension, scored deterministically into a Business Score.
// Self-reported answers only: nothing here is verified against the business's real assets.

export const AUDIT_VERSION = 1;

export const MATURITY_LEVELS = ["none", "adHoc", "defined", "optimized"] as const;
export type MaturityLevel = (typeof MATURITY_LEVELS)[number];

export const AUDIT_DIMENSIONS = ["web", "social", "capture", "followUp", "automation", "analytics", "advertising", "ai"] as const;
export type AuditDimension = (typeof AUDIT_DIMENSIONS)[number];

// Weights sum to 100, so a business at "optimized" everywhere scores 100.
export const DIMENSION_WEIGHTS: Record<AuditDimension, number> = {
  web: 15,
  social: 10,
  capture: 20,
  followUp: 15,
  automation: 10,
  analytics: 15,
  advertising: 10,
  ai: 5,
};

// The four dimensions that decide whether a business already has a digital infrastructure.
export const INFRASTRUCTURE_PILLARS = ["web", "capture", "followUp", "analytics"] as const satisfies readonly AuditDimension[];

export type AuditAnswers = Record<AuditDimension, MaturityLevel>;

export type AuditBand = "initial" | "basic" | "intermediate" | "advanced";
export type Infrastructure = "none" | "partial" | "established";

export type AuditGap = { dimension: AuditDimension; level: MaturityLevel; impact: number };

export type AuditResult = {
  version: typeof AUDIT_VERSION;
  basis: "selfReported";
  score: number;
  band: AuditBand;
  infrastructure: Infrastructure;
  gaps: AuditGap[];
  strengths: AuditDimension[];
};

// A tenant's offer (Nova's services, KYNOVA's modules) is data, not code: each entry says which gaps it closes.
export type CatalogService = {
  id: string;
  addresses: readonly AuditDimension[];
  fitsInfrastructure: readonly Infrastructure[];
};

export type ServiceRecommendation = { serviceId: string; score: number; because: AuditDimension[] };

export const BUDGETS = ["unknown", "low", "medium", "high"] as const;
export type Budget = (typeof BUDGETS)[number];

export const TIMELINES = ["exploring", "later", "soon", "now"] as const;
export type Timeline = (typeof TIMELINES)[number];

export const DECISION_ROLES = ["none", "influencer", "owner"] as const;
export type DecisionRole = (typeof DECISION_ROLES)[number];

export type QualificationInput = {
  budget: Budget;
  timeline: Timeline;
  decisionRole: DecisionRole;
  hasContact: boolean;
};

export type QualificationGrade = "hot" | "warm" | "cold";

// Thresholds and points belong to the tenant: each business decides what a good prospect looks like.
export type QualificationRules = {
  budget: Record<Budget, number>;
  timeline: Record<Timeline, number>;
  decisionRole: Record<DecisionRole, number>;
  contact: number;
  hotMin: number;
  warmMin: number;
};

export type Qualification = {
  grade: QualificationGrade;
  points: number;
  reasons: { factor: "budget" | "timeline" | "decisionRole" | "contact"; points: number }[];
};
