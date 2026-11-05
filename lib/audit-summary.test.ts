import { describe, expect, it } from "vitest";
import { AUDIT_DIMENSIONS, type AuditAnswers, type MaturityLevel } from "@/lib/contracts/audit";
import { runAudit } from "@/lib/audit";
import { DIMENSION_COPY } from "@/lib/audit-copy";
import { NOVA_DRAFT_PACK } from "@/lib/audit-packs/nova-draft";
import { buildSummary } from "./audit-summary";

const all = (level: MaturityLevel): AuditAnswers => Object.fromEntries(AUDIT_DIMENSIONS.map((dimension) => [dimension, level])) as AuditAnswers;
const catalog = NOVA_DRAFT_PACK.catalog;

describe("consultant summary", () => {
  it("always answers the five questions, with the three biggest gaps as opportunities", () => {
    const summary = buildSummary(runAudit({ ...all("defined"), capture: "none", web: "none", followUp: "adHoc", social: "adHoc" }), { catalog });
    expect(summary.found.length).toBeGreaterThanOrEqual(2);
    expect(summary.opportunities.map((o) => o.dimension)).toEqual(["capture", "web", "followUp"]);
    expect(summary.first).toContain(DIMENSION_COPY.capture.opportunity.action);
    expect(summary.automate).toHaveLength(3);
    expect(summary.approval.length).toBeGreaterThan(summary.opportunities.length);
  });

  it("is deterministic: the same answers give the same summary", () => {
    const result = runAudit({ ...all("adHoc"), web: "optimized" });
    expect(buildSummary(result, { catalog })).toEqual(buildSummary(result, { catalog }));
  });

  it("does not invent opportunities when there are no gaps", () => {
    const summary = buildSummary(runAudit(all("optimized")), { catalog });
    expect(summary.opportunities).toEqual([]);
    expect(summary.automate).toEqual([]);
    expect(summary.services).toEqual([]);
    expect(summary.first.length).toBeGreaterThan(0);
  });

  it("recommends only services that fit the stage and shows why", () => {
    const summary = buildSummary(runAudit(all("none")), { catalog });
    expect(summary.services.length).toBeGreaterThan(0);
    expect(summary.services.map((s) => s.serviceId)).not.toContain("ai");
    expect(summary.services.every((s) => s.because.length > 0)).toBe(true);
  });

  it("speaks in usted or tú and names the business when given", () => {
    const result = runAudit(all("none"));
    expect(buildSummary(result, { treatment: "usted", businessName: " Café Sol " }).found[0]).toMatch(/^Según lo que usted me indicó, Café Sol/);
    expect(buildSummary(result, { treatment: "tu" }).found[0]).toMatch(/^Según lo que me indicaste, tu negocio/);
  });

  it("never mentions prices, deadlines or guaranteed results in any copy", () => {
    const text = JSON.stringify([DIMENSION_COPY, NOVA_DRAFT_PACK.services]).toLowerCase();
    for (const word of ["$", "garantiz", "precio", "días hábiles"]) expect(text).not.toContain(word);
    expect(text).not.toMatch(/en \d+ (días|semanas|meses)/);
  });

  it("has copy for every dimension and level", () => {
    for (const dimension of AUDIT_DIMENSIONS) {
      for (const level of ["none", "adHoc", "defined", "optimized"] as const) {
        expect(DIMENSION_COPY[dimension].options[level].length).toBeGreaterThan(0);
        expect(DIMENSION_COPY[dimension].reaction[level].length).toBeGreaterThan(0);
      }
    }
  });
});
