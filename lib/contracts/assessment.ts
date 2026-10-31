// Business Assessment v0: closed questions answered in memory only (never persisted).

export const ASSESSMENT_QUESTIONS = ["sector", "teamSize", "channel", "crm", "problem", "goal"] as const;

export type AssessmentQuestion = (typeof ASSESSMENT_QUESTIONS)[number];

export const ASSESSMENT_OPTIONS = {
  sector: ["realEstate", "marketingAgency", "professionalServices", "software", "retail", "other"],
  teamSize: ["solo", "small", "medium", "large"],
  channel: ["web", "social", "referrals", "ads", "inPerson"],
  crm: ["none", "spreadsheets", "basicTool", "fullCrm"],
  problem: ["leads", "followUp", "cash", "manualWork", "visibility"],
  goal: ["moreSales", "organizeClients", "automate", "controlFinances", "understandData"],
} as const;

export type AssessmentOption<Q extends AssessmentQuestion> = (typeof ASSESSMENT_OPTIONS)[Q][number];

export type AssessmentAnswers = { [Q in AssessmentQuestion]: AssessmentOption<Q> };
