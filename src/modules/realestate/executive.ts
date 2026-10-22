import { ceoBrief, confidence, heatOf, inWindow, rankBy, runRate, timeSaved, topBy, trend, weeklyReport, type Confidence, type Finding, type Level, type Params, type Signal } from "@/platform/intelligence";
import { requirements, type KnowledgeState } from "@/platform/business-profile/knowledge";
import { requirements as integrationRequirements, type IntegrationState } from "@/platform/integrations/status";
import type { WorkflowItem } from "@/platform/workflows";
import type { Kpis } from "./engine";
import { DAY, buyerOpportunity, healthScore, ownerOpportunity, propertyOpportunity } from "./scores";
import { ix, type Facts } from "./workflows";

/**
 * Real Estate adapter of the Executive Intelligence Layer (Entrega 13). Pure: it reads the recorded facts and the work items the team already produced
 * and returns STRUCTURED data (codes + numbers). Wording is chosen by the UI language; nothing here is fixed prose, and no AI is involved.
 */
/** Fixed estimated minutes saved per unit of work. They are estimates, never measured time. */
export const MINUTES_EACH = { buyer_matching: 25, followup: 40, listing_review: 30, opportunity: 10, performance_watch: 15, bootstrap_growth: 20, publication: 60 } as const;
/** What each recommendation needs from the Business Profile to be useful. Missing items are reported, never guessed. */
export const NEEDS: Readonly<Record<string, readonly string[]>> = {
  growth_content: ["dna.tone", "dna.valueProposition", "dna.keywords"], growth_local: ["profile.website", "profile.location", "dna.keywords"], growth_captation: ["dna.customerType", "dna.objectives"],
  listing_review: ["dna.valueProposition"], buyer_matches: [], growth_referrals: [],
};
/** Platforms whose real data a recommendation would need. Without them it is reported as blocked, never filled in. */
export const INTEGRATION_NEEDS: Readonly<Record<string, readonly string[]>> = { growth_content: ["search_console"], growth_local: ["google_business"] };
/** Platforms the CEO AI always checks before talking about SEO, traffic or local presence. */
export const CEO_WATCH = ["search_console", "ga4", "google_business"] as const;
/** Which strategic priority (Business DNA) a piece of work serves. */
export const SERVES: Readonly<Record<string, string>> = { growth_captation: "acquisition", followup_owner: "acquisition", followup_buyer: "retention", buyer_matches: "sales", closings_down: "sales", listing_review: "sales", growth_content: "brand", growth_local: "brand", growth_referrals: "growth" };
const sig = (code: string, weight: number, met: boolean): Signal => ({ code, weight, met });
const prim = (p: WorkflowItem["params"]): Params => Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v !== "boolean")) as Params;
export interface Ranked { kind: "buyer" | "owner" | "property"; id: string; name: string; level: Level; heat: "hot" | "warm" | "cold"; points: number; idle: number; reasons: { code: string; points: number }[]; confidence: Confidence }

export function buildExecutive(f: Facts, items: readonly WorkflowItem[], kpis: Kpis, bp: KnowledgeState | null = null, ig: IntegrationState | null = null) {
  const x = ix(f), now = f.now, days = (t: number) => Math.floor((now - t) / DAY);
  const buyerById = new Map(f.buyers.map((b) => [b.id, b])), ownerById = new Map(f.owners.map((o) => [o.id, o])), propsOfOwner = new Map<string, number>();
  for (const p of f.props) if (p.ownerId) propsOfOwner.set(p.ownerId, (propsOfOwner.get(p.ownerId) ?? 0) + 1);

  /* Opportunity ranking, heat and the explanation, for every buyer, owner and property. */
  const ranked: Ranked[] = [], propInfo = new Map<string, { s: ReturnType<typeof x.signals>; health: ReturnType<typeof healthScore>; days: number }>();
  for (const b of x.liveBuyers) {
    const m = x.matchesOfBuyer(b), idle = x.idle("buyer", b.id, b.updatedAt), o = buyerOpportunity(b, m, idle);
    ranked.push({ kind: "buyer", id: b.id, name: b.name, level: o.level, heat: heatOf(o.level), points: o.points, idle, reasons: o.reasons, confidence: confidence([sig("budget_set", 25, b.budgetMaxMinor > 0), sig("zones_set", 15, b.zones.length > 0), sig("strong_match", 25, (m[0]?.score ?? 0) >= 80), sig("recent_activity", 20, idle <= 14), sig("has_contact", 15, Boolean(b.phone || b.email))]) });
  }
  for (const o of f.owners.filter((q) => q.stage !== "lost")) {
    const idle = x.idle("owner", o.id, o.updatedAt), r = ownerOpportunity(o, propsOfOwner.get(o.id) ?? 0, idle, now);
    ranked.push({ kind: "owner", id: o.id, name: o.name, level: r.level, heat: heatOf(r.level), points: r.points, idle, reasons: r.reasons, confidence: confidence([sig("has_contact", 30, Boolean(o.phone || o.email)), sig("has_action", 20, o.nextAction !== ""), sig("stage_active", 25, o.stage === "meeting" || o.stage === "contacted"), sig("recent_activity", 25, idle <= 14)]) });
  }
  const live = f.props.filter((p) => p.status === "active" || p.status === "reserved");
  for (const p of live) {
    const s = x.signals(p), health = healthScore(p, s), r = propertyOpportunity(p, s.matchingBuyers, s.doneVisits, health.score), d = days(p.listedAt); propInfo.set(p.id, { s, health, days: d });
    ranked.push({ kind: "property", id: p.id, name: p.title, level: r.level, heat: heatOf(r.level), points: r.points, idle: d, reasons: r.reasons, confidence: confidence([sig("desc_ok", 20, p.description.trim().length >= 80), sig("fields_ok", 20, (health.factors.find((q) => q.code === "fields")?.points ?? 0) >= 16), sig("has_visits", 20, s.doneVisits > 0), sig("demand_data", 20, s.liveBuyers > 0), sig("listed_7", 20, d >= 7)]) });
  }
  const top = (k: Ranked["kind"]) => rankBy(ranked.filter((r) => r.kind === k), 3);

  /* Findings the CEO interprets: open work (actions), the best opportunity, the biggest risk. */
  const open = items.filter((i) => i.status === "open"), findings: Finding[] = [];
  const itemSignals = (i: WorkflowItem): Signal[] => {
    const p = i.params, rec = buyerById.get(i.subjectId) ?? ownerById.get(i.subjectId);
    if (i.code === "buyer_matches") { const b = buyerById.get(i.subjectId); return [sig("budget_set", 25, (b?.budgetMaxMinor ?? 0) > 0), sig("zones_set", 15, (b?.zones.length ?? 0) > 0), sig("strong_match", 35, Number(p.best) >= 80), sig("multi_match", 25, Number(p.count) >= 2)]; }
    if (i.code.startsWith("followup_")) return [sig("idle_7", 35, true), sig("idle_14", 35, Number(p.days) >= 14), sig("has_contact", 30, Boolean(rec?.phone || rec?.email))];
    if (i.code === "listing_review") return [sig("no_visits", 35, Number(p.visits) === 0), sig("days_60", 35, Number(p.days) >= 60), sig("no_buyers", 30, Number(p.buyers) === 0)];
    if (i.code.startsWith("opportunity_")) return [sig("points_high", 60, Number(p.points) >= 60), sig("points_80", 40, Number(p.points) >= 80)];
    return [sig("prev_base", 50, Number(p.prev ?? 0) >= 2), sig("window_full", 50, f.props.some((q) => days(q.createdAt) >= 14))];
  };
  for (const i of open) {
    // The CEO reads the Business Profile as context: a priority the company chose lifts the work that serves it; what the work still needs is listed, never invented.
    const serves = SERVES[i.code], match = Boolean(bp && serves && bp.priorities.includes(serves)), need = NEEDS[i.code] ?? [], miss = requirements(bp, need).missing;
    const blocked = ig ? integrationRequirements(ig, INTEGRATION_NEEDS[i.code] ?? []).missing.map((m) => `${m.key}:${m.status}`) : [];
    const base = itemSignals(i), signals = bp && bp.priorities.length > 0 && serves ? [...base, sig("dna_priority", 15, match)] : base;
    findings.push({ id: i.id, kind: "action", employee: i.employee, code: i.code, params: prim(i.params), subjectKind: i.subjectKind, subjectId: i.subjectId, priority: i.priority, points: Number(i.params.days ?? i.params.best ?? i.params.points ?? 0) + (match ? 50 : 0), confidence: confidence(signals), ...(bp && miss.length ? { needs: miss } : {}), ...(blocked.length ? { blocked } : {}) });
  }
  if (bp && (bp.profilePct < 60 || bp.dnaPct < 40)) findings.push({ id: "profile", kind: "action", employee: "real_estate_director", code: "profile_incomplete", params: { profile: bp.profilePct, dna: bp.dnaPct, missing: bp.pending.slice(0, 4).join(",") }, subjectKind: null, subjectId: null, priority: "medium", points: 0, confidence: confidence([sig("sample_1", 100, true)]) });
  const best = topBy(ranked.filter((r) => r.points > 0), (r) => r.points);
  if (best) findings.push({ id: `opp:${best.id}`, kind: "opportunity", employee: "real_estate_director", code: `opportunity_${best.kind}`, params: { name: best.name, level: best.level, points: best.points }, subjectKind: best.kind, subjectId: best.id, priority: best.level, points: best.points, confidence: best.confidence });
  for (const [id, v] of propInfo) {
    const p = f.props.find((q) => q.id === id)!;
    if (p.status === "active" && v.days >= 30 && v.s.doneVisits === 0) findings.push({ id: `risk:${id}`, kind: "risk", employee: "analytics_manager", code: "risk_stale", params: { title: p.title, days: v.days, health: v.health.score }, subjectKind: "property", subjectId: id, priority: v.days >= 60 ? "high" : "medium", points: v.days + 20 + Math.round((100 - v.health.score) / 2), confidence: confidence([sig("no_visits", 35, true), sig("days_60", 30, v.days >= 60), sig("demand_data", 35, v.s.liveBuyers > 0)]) });
  }
  for (const r of ranked) if (r.kind !== "property" && r.level === "high" && r.idle >= 7) findings.push({ id: `risk:${r.id}`, kind: "risk", employee: "analytics_manager", code: "risk_hot_idle", params: { name: r.name, days: r.idle }, subjectKind: r.kind, subjectId: r.id, priority: r.idle >= 14 ? "high" : "medium", points: 60 + r.idle, confidence: confidence([sig("idle_14", 40, r.idle >= 14), sig("points_high", 30, true), sig("recent_activity", 30, false)]) });
  const ceo = ceoBrief(findings);

  /* Trends: this week against the week before, from dated facts only. */
  const T = {
    clients: [...f.buyers.map((b) => b.createdAt), ...f.owners.map((o) => o.createdAt)], captation: f.owners.map((o) => o.createdAt), properties: f.props.map((p) => p.createdAt),
    activity: f.acts.filter((a) => a.status === "done").map((a) => a.whenAt), closings: f.props.flatMap((p) => (p.closedAt === null ? [] : [p.closedAt])),
  } as const;
  const trends = (Object.keys(T) as (keyof typeof T)[]).map((metric) => ({ metric, ...trend(inWindow(T[metric], now, 7, 0), inWindow(T[metric], now, 7, 1)) })).filter((t) => t.direction !== "insufficient");
  const tConf = (t: { cur: number; prev: number }) => confidence([sig("prev_base", 50, t.prev >= 2), sig("sample_1", 50, t.cur + t.prev >= 4)]);
  const downs = trends.filter((t) => t.direction === "down" && t.prev >= 1), ups = trends.filter((t) => t.direction === "up");
  const drop = topBy(downs, (t) => t.prev - t.cur), growth = topBy(ups, (t) => t.cur - t.prev);

  /* Insights: always with the reason (params) and a confidence. */
  const withPotential = [...propInfo].filter(([, v]) => v.s.matchingBuyers > 0), pot = topBy(withPotential, ([, v]) => v.s.matchingBuyers * 100 + v.health.score);
  const potRanked = pot ? ranked.find((r) => r.kind === "property" && r.id === pot[0]) : undefined;
  const visits30 = new Map<string, number>(); for (const a of f.acts) if (a.status === "done" && a.propertyId && now - a.whenAt <= 30 * DAY && a.whenAt <= now) visits30.set(a.propertyId, (visits30.get(a.propertyId) ?? 0) + 1);
  const act = topBy([...visits30], ([, n]) => n);
  const insights = {
    potential: pot && potRanked ? { subjectId: pot[0], params: { title: potRanked.name, buyers: pot[1].s.matchingBuyers, health: pot[1].health.score }, confidence: potRanked.confidence } : null,
    risk: ceo.risk, opportunity: ceo.opportunity,
    activity: act ? { subjectId: act[0], params: { title: f.props.find((p) => p.id === act[0])?.title ?? "", visits: act[1] }, confidence: confidence([sig("sample_3", 60, act[1] >= 3), sig("sample_1", 40, true)]) } : null,
    drop: drop ? { ...drop, confidence: tConf(drop) } : null, growth: growth ? { ...growth, confidence: tConf(growth) } : null,
  };

  /* Forecast (a plain run-rate) and the weekly report. */
  const c28 = inWindow(T.closings, now, 28, 0), rr = runRate(c28, 28, 30);
  const forecast = c28 > 0 ? { ...rr, confidence: confidence([sig("sample_1", 20, true), sig("sample_3", 40, c28 >= 3), sig("window_full", 40, f.props.some((p) => days(p.createdAt) >= 28))]) } : null;
  const wf = (code: string) => items.filter((i) => i.workflow === code).map((i) => i.createdAt);
  const weekly = { rows: weeklyReport([
    { key: "properties", cur: inWindow(T.properties, now, 7, 0), prev: inWindow(T.properties, now, 7, 1) }, { key: "buyers", cur: inWindow(f.buyers.map((b) => b.createdAt), now, 7, 0), prev: inWindow(f.buyers.map((b) => b.createdAt), now, 7, 1) },
    { key: "matching", cur: inWindow(wf("buyer_matching"), now, 7, 0), prev: inWindow(wf("buyer_matching"), now, 7, 1) }, { key: "followups", cur: inWindow(wf("followup"), now, 7, 0), prev: inWindow(wf("followup"), now, 7, 1) },
    { key: "publications", cur: inWindow(f.pubs.map((p) => p.createdAt), now, 7, 0), prev: inWindow(f.pubs.map((p) => p.createdAt), now, 7, 1) }, { key: "closings", cur: inWindow(T.closings, now, 7, 0), prev: inWindow(T.closings, now, 7, 1) },
  ]), conversionPct: kpis.conversionPct };

  /* Time saved and business value: accumulated from the work that really exists. */
  const counts = (since: number) => {
    const c: Record<string, number> = {}; for (const i of items) if (i.createdAt > since) c[i.workflow] = (c[i.workflow] ?? 0) + 1;
    c.publication = new Set(f.pubs.filter((p) => p.createdAt > since).map((p) => p.propertyId)).size; return c;
  }, all = counts(0);
  return {
    generatedAt: now, ceo, insights, ranking: { buyers: top("buyer"), owners: top("owner"), properties: top("property") }, trends, forecast, weekly,
    timeSaved: { last24h: timeSaved(counts(now - DAY), MINUTES_EACH), total: timeSaved(all, MINUTES_EACH), estimated: true as const },
    value: { opportunities: all.opportunity ?? 0, followups: all.followup ?? 0, publications: f.pubs.length, matchings: all.buyer_matching ?? 0 },
    context: bp ? { profilePct: bp.profilePct, dnaPct: bp.dnaPct, priorities: bp.priorities, pending: bp.pending.slice(0, 4) } : null,
    integrations: ig ? integrationRequirements(ig, CEO_WATCH).missing.map((m) => `${m.key}:${m.status}`) : null,
    engine: "rules" as const, ai: false as const, truncated: items.length >= 1000 || f.props.length >= 2000 || f.buyers.length >= 2000,
  };
}
export type Executive = ReturnType<typeof buildExecutive>;
