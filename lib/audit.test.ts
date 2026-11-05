import { describe, expect, it } from "vitest";
import { AUDIT_DIMENSIONS, DIMENSION_WEIGHTS, type AuditAnswers, type CatalogService, type MaturityLevel } from "@/lib/contracts/audit";
import {
  DEFAULT_QUALIFICATION_RULES,
  auditGaps,
  bandOf,
  businessScore,
  classifyInfrastructure,
  parseAuditAnswers,
  parseQualificationInput,
  qualifyLead,
  recommendServices,
  runAudit,
} from "./audit";

const all = (level: MaturityLevel): AuditAnswers => Object.fromEntries(AUDIT_DIMENSIONS.map((dimension) => [dimension, level])) as AuditAnswers;
const with_ = (base: AuditAnswers, patch: Partial<AuditAnswers>): AuditAnswers => ({ ...base, ...patch });

describe("Business Score", () => {
  it("weights add up to 100, so the range is 0 to 100", () => {
    expect(Object.values(DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(businessScore(all("none"))).toBe(0);
    expect(businessScore(all("optimized"))).toBe(100);
  });

  it("scores proportionally to the weight of each dimension", () => {
    expect(businessScore(all("defined"))).toBe(67);
    expect(businessScore(with_(all("none"), { capture: "optimized" }))).toBe(20);
    expect(businessScore(with_(all("none"), { ai: "optimized" }))).toBe(5);
  });

  it("maps scores to bands at 25, 50 and 75", () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(bandOf)).toEqual(["initial", "initial", "basic", "basic", "intermediate", "intermediate", "advanced", "advanced"]);
  });
});

describe("infrastructure stage", () => {
  const pillars = (level: MaturityLevel, names: (keyof AuditAnswers)[]) => with_(all("none"), Object.fromEntries(names.map((name) => [name, level])));

  it("is none when no pillar reaches the defined level, whatever the rest says", () => {
    expect(classifyInfrastructure(with_(all("optimized"), { web: "adHoc", capture: "none", followUp: "adHoc", analytics: "none" }))).toBe("none");
  });

  it("is partial with one or two solid pillars and established with three or four", () => {
    expect(classifyInfrastructure(pillars("defined", ["web"]))).toBe("partial");
    expect(classifyInfrastructure(pillars("defined", ["web", "capture"]))).toBe("partial");
    expect(classifyInfrastructure(pillars("defined", ["web", "capture", "analytics"]))).toBe("established");
    expect(classifyInfrastructure(all("optimized"))).toBe("established");
  });

  it("ignores non-pillar dimensions", () => {
    expect(classifyInfrastructure(pillars("optimized", ["social", "automation", "advertising", "ai"]))).toBe("none");
  });
});

describe("gaps and strengths", () => {
  it("lists only dimensions below defined, biggest impact first, ties by dimension order", () => {
    const gaps = auditGaps(with_(all("defined"), { capture: "none", followUp: "adHoc", social: "none", ai: "none" }));
    expect(gaps.map((gap) => gap.dimension)).toEqual(["capture", "social", "followUp", "ai"]); // social and followUp tie at 30: dimension order decides
    expect(gaps.map((gap) => gap.impact)).toEqual([60, 30, 30, 15]);
  });

  it("is empty at defined or better, and the result is deterministic", () => {
    expect(auditGaps(all("defined"))).toEqual([]);
    const answers = with_(all("adHoc"), { web: "optimized" });
    expect(runAudit(answers)).toEqual(runAudit({ ...answers }));
  });

  it("marks self-reported basis and splits dimensions into gaps and strengths", () => {
    const result = runAudit(with_(all("none"), { web: "optimized", social: "defined" }));
    expect(result.basis).toBe("selfReported");
    expect(result.strengths).toEqual(["web", "social"]);
    expect(result.gaps.map((gap) => gap.dimension)).not.toContain("web");
  });
});

const catalog: CatalogService[] = [
  { id: "website", addresses: ["web", "capture"], fitsInfrastructure: ["none", "partial"] },
  { id: "social", addresses: ["social", "advertising"], fitsInfrastructure: ["none", "partial", "established"] },
  { id: "crmSetup", addresses: ["followUp", "automation"], fitsInfrastructure: ["partial", "established"] },
  { id: "analytics", addresses: ["analytics"], fitsInfrastructure: ["established"] },
];

describe("service recommendation", () => {
  it("ranks the offer by the gaps it closes and explains why", () => {
    const result = runAudit(with_(all("defined"), { web: "none", capture: "none", social: "adHoc" }));
    expect(result.infrastructure).toBe("partial");
    const [first, second] = recommendServices(result, catalog);
    expect(first).toEqual({ serviceId: "website", score: 15 * 3 + 20 * 3, because: ["capture", "web"] });
    expect(second.serviceId).toBe("social");
  });

  it("does not recommend a service that does not fit the infrastructure stage", () => {
    const newBusiness = runAudit(all("none"));
    expect(newBusiness.infrastructure).toBe("none");
    expect(recommendServices(newBusiness, catalog).map((r) => r.serviceId)).not.toContain("crmSetup");
    const established = runAudit(with_(all("optimized"), { analytics: "none", web: "optimized" }));
    expect(established.infrastructure).toBe("established");
    expect(recommendServices(established, catalog).map((r) => r.serviceId)).toEqual(["analytics"]);
  });

  it("returns nothing when there are no gaps and respects the maximum", () => {
    expect(recommendServices(runAudit(all("optimized")), catalog)).toEqual([]);
    expect(recommendServices(runAudit(all("none")), catalog, 1)).toHaveLength(1);
  });

  it("breaks ties by service id so the order never changes between runs", () => {
    const twins: CatalogService[] = [
      { id: "b", addresses: ["ai"], fitsInfrastructure: ["none"] },
      { id: "a", addresses: ["ai"], fitsInfrastructure: ["none"] },
    ];
    expect(recommendServices(runAudit(all("none")), twins).map((r) => r.serviceId)).toEqual(["a", "b"]);
  });
});

describe("lead qualification", () => {
  const ready = { budget: "high", timeline: "now", decisionRole: "owner", hasContact: true } as const;

  it("grades with the default rules", () => {
    expect(qualifyLead(ready)).toMatchObject({ grade: "hot", points: 9 });
    expect(qualifyLead({ budget: "medium", timeline: "soon", decisionRole: "influencer", hasContact: false }).grade).toBe("warm");
    expect(qualifyLead({ budget: "unknown", timeline: "exploring", decisionRole: "none", hasContact: false })).toMatchObject({ grade: "cold", points: 0 });
  });

  it("explains every point it gives", () => {
    const { reasons, points } = qualifyLead(ready);
    expect(reasons.map((reason) => reason.factor)).toEqual(["budget", "timeline", "decisionRole", "contact"]);
    expect(reasons.reduce((sum, reason) => sum + reason.points, 0)).toBe(points);
  });

  it("lets the tenant set its own thresholds", () => {
    const strict = { ...DEFAULT_QUALIFICATION_RULES, hotMin: 9, warmMin: 8 };
    expect(qualifyLead({ ...ready, hasContact: false }, strict)).toMatchObject({ grade: "warm", points: 8 });
    expect(qualifyLead({ ...ready, budget: "low", hasContact: false }, strict).grade).toBe("cold");
    expect(qualifyLead(ready, strict).grade).toBe("hot");
  });
});

describe("boundary parsers", () => {
  it("accepts a complete, closed set of audit answers", () => {
    expect(parseAuditAnswers(all("defined"))).toEqual(all("defined"));
  });

  it("rejects missing, extra or unknown values", () => {
    const { web: _web, ...missing } = all("none");
    void _web;
    expect(parseAuditAnswers(missing)).toBeNull();
    expect(parseAuditAnswers({ ...all("none"), extra: "none" })).toBeNull();
    expect(parseAuditAnswers({ ...all("none"), web: "expert" })).toBeNull();
    expect(parseAuditAnswers(null)).toBeNull();
    expect(parseAuditAnswers([])).toBeNull();
  });

  it("validates qualification input strictly", () => {
    expect(parseQualificationInput({ budget: "low", timeline: "later", decisionRole: "none", hasContact: false })).toEqual({
      budget: "low",
      timeline: "later",
      decisionRole: "none",
      hasContact: false,
    });
    expect(parseQualificationInput({ budget: "low", timeline: "later", decisionRole: "none", hasContact: "yes" })).toBeNull();
    expect(parseQualificationInput({ budget: "huge", timeline: "later", decisionRole: "none", hasContact: true })).toBeNull();
    expect(parseQualificationInput({ budget: "low", timeline: "later", decisionRole: "none" })).toBeNull();
  });
});
