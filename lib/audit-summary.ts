import type { AuditDimension, AuditResult, ServiceRecommendation } from "@/lib/contracts/audit";
import type { CatalogService } from "@/lib/contracts/audit";
import { recommendServices } from "@/lib/audit";
import { BAND_COPY, DIMENSION_COPY, GENERIC_APPROVALS, INFRASTRUCTURE_COPY, pick, type Treatment } from "@/lib/audit-copy";

// The consultant's closing summary, built by rules from the audit result. No model is involved: the same answers
// always produce the same summary. It always answers the same five questions (AUDIT_SUMMARY_SECTIONS).

export const AUDIT_SUMMARY_SECTIONS = ["found", "opportunities", "first", "automate", "approval"] as const;

export type SummaryOpportunity = { dimension: AuditDimension; title: string; why: string; action: string };

export type AuditSummary = {
  // 1. What was found
  found: string[];
  // 2. The three most important opportunities (fewer if the business has fewer gaps)
  opportunities: SummaryOpportunity[];
  // 3. What to do first
  first: string;
  // 4. What KYNOVA can prepare today (always as a draft)
  automate: string[];
  // 5. What needs the owner's approval
  approval: string[];
  // The client's own services that close those gaps
  services: ServiceRecommendation[];
};

export const TOP_OPPORTUNITIES = 3;

export function buildSummary(
  result: AuditResult,
  options: { catalog?: readonly CatalogService[]; treatment?: Treatment; businessName?: string } = {},
): AuditSummary {
  const { catalog = [], treatment = "usted", businessName } = options;
  const subject = businessName?.trim() ? businessName.trim() : pick(treatment, ["su negocio", "tu negocio"]);
  const band = BAND_COPY[result.band];
  const infrastructure = INFRASTRUCTURE_COPY[result.infrastructure];
  const top = result.gaps.slice(0, TOP_OPPORTUNITIES);

  const found = [
    `Según lo que ${pick(treatment, ["usted me indicó", "me indicaste"])}, ${subject} está en un nivel ${band.label.toLowerCase()} (${result.score} de 100): ${band.line}.`,
    infrastructure.line,
  ];
  if (result.strengths.length > 0) {
    const names = result.strengths.slice(0, 2).map((dimension) => DIMENSION_COPY[dimension].label.toLowerCase());
    found.push(`Lo que ya juega a ${pick(treatment, ["su", "tu"])} favor: ${names.join(" y ")}.`);
  }
  if (top.length === 0) {
    found.push(`No encontré brechas importantes en lo que ${pick(treatment, ["respondió", "respondiste"])}; el siguiente paso es sostener y medir.`);
  }

  const opportunities = top.map(({ dimension }) => ({ dimension, ...DIMENSION_COPY[dimension].opportunity }));
  const first = top.length > 0 ? `${DIMENSION_COPY[top[0].dimension].opportunity.action} ${infrastructure.first}` : infrastructure.first;
  const automate = top.map(({ dimension }) => DIMENSION_COPY[dimension].automate);
  const approval = [...top.map(({ dimension }) => DIMENSION_COPY[dimension].approval), ...GENERIC_APPROVALS];

  return { found, opportunities, first, automate, approval, services: recommendServices(result, catalog, TOP_OPPORTUNITIES) };
}
