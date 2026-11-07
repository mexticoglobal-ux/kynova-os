import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditFit, auditModules, isAuditAnswers } from "./crm-audit";
import {
  analysesOf, customersOf, grantsOf, latestAnalysis, leadsOf, newCrmState, reduceCrm, tasksOf, validateLead, type CrmEvent, type CrmState, type KoeEnv, type Lead, type LeadInput, type Stage, type TimelineEntry,
} from "./crm-center";
import { COLD_ANSWERS, DEMO_NOW, DEMO_PERSONAS, HOT_ANSWERS, demoCrmOk } from "./crm-demo";
import { ERROR_CODES, label, message } from "./crm-messages";
import {
  ADVANCE_THRESHOLD, FUTURE_CRM, HIGH_PROBABILITY, STAGE_BASE, STAGE_DAYS, advanceCheck, analyzeLead, assistantMessages, contextOf, crmDashboard, customer360, draftFor, pipelineBoard, proposalsFor, timelineOf,
} from "./koe-crm";
import { BASE_MODELS } from "./koe-registry";
import { ACTION_LEVELS } from "./workers";

const ANA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: "tenant-nova", actor: "system" };
const LUCIA = { tenantId: "tenant-vida", actor: "lucia" };
const t = (month: number, day: number, hour = 10) => `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const usd = (n: number) => n * 1_000_000;

const step = (state: CrmState, event: CrmEvent, env?: KoeEnv) => reduceCrm(state, event, env);
const must = (state: CrmState, event: CrmEvent, env?: KoeEnv): CrmState => { const result = reduceCrm(state, event, env); expect(result.error, event.type).toBeUndefined(); return result.state; };
const input = (over: Partial<LeadInput> = {}): LeadInput => ({ name: "Ana Prueba", company: "Empresa Prueba", source: "Formulario web", estimatedValueMicros: usd(1_000), fit: 70, owner: "ana", ...over });
const created = (state = newCrmState(), who = ANA, over: Partial<LeadInput> = {}, day = 1) => {
  const next = must(state, { ...who, at: t(10, day), type: "lead.create", input: input(over) });
  return { state: next, id: next.leads.at(-1)?.id ?? "" };
};
const touch = (state: CrmState, id: string, day: number, kind: "email" | "call" | "whatsapp" = "call") => must(state, { ...ANA, at: t(10, day), type: "interaction.record", subject: { kind: "lead", id }, kind, direction: "out", summary: "Contacto" });
const move = (state: CrmState, id: string, to: Stage, day: number, who = ANA) => must(state, { ...who, at: t(10, day), type: "stage.move", leadId: id, to });
const GRANT: CrmEvent = { ...ANA, at: t(10, 1), type: "authorization.grant", maxPerDay: 2 };

// a lead built by hand for the pure engine: no reducer involved
const handLead = (over: Partial<Lead> = {}): Lead => ({
  id: "ld_x", tenantId: "tenant-nova", name: "Mario Solís", company: "Casa Solís", source: "Web", estimatedValueMicros: usd(1_000), fit: 70, owner: "ana", stage: "qualified", stageSince: t(10, 20), stageHistory: [],
  createdBy: "ana", createdAt: t(10, 15), updatedAt: t(10, 20), ...over,
});
const entry = (kind: TimelineEntry["kind"], at: string): TimelineEntry => ({ id: `tl_${at}${kind}`, tenantId: "tenant-nova", subject: { kind: "lead", id: "ld_x" }, at, kind, summary: "x", actor: "ana" });
const insight = (lead: Lead, timeline: TimelineEntry[] = [], asOf = t(10, 25)) => analyzeLead({ lead, timeline, tasks: [], audits: [] }, asOf);

const demo = demoCrmOk();
const board = pipelineBoard(demo, "tenant-nova", DEMO_NOW);
const card = (name: string) => board.flatMap((column) => column.cards).find((item) => item.name === name);

describe("the sample loads without a refusal and shows every case", () => {
  it("has prospects in every stage, customers, tasks, audits, timeline and KOE analyses", () => {
    expect(board.map((column) => [column.stage, column.count])).toEqual([["prospect", 1], ["qualified", 2], ["meeting", 0], ["proposal", 1], ["negotiation", 1], ["won", 2], ["lost", 1]]);
    expect(customersOf(demo, "tenant-nova").map((item) => item.company).sort()).toEqual(["Boutique Luna", "Studio Verde"]);
    expect(demo.audits.length).toBeGreaterThan(3);
    expect(analysesOf(demo, "tenant-nova").length).toBeGreaterThan(20);
    expect(new Set(demo.timeline.map((item) => item.kind))).toEqual(new Set(["email", "whatsapp", "call", "note", "meeting", "automation", "worker", "audit", "nex"]));
    expect(tasksOf(demo, "tenant-nova").map((item) => item.status).sort()).toEqual(["accepted", "done", "proposed", "proposed", "proposed", "proposed", "proposed"]);
    expect(DEMO_PERSONAS).toHaveLength(4);
  });

  it("shows the commercial dashboard: new, active, opportunities, customers, estimated sales, conversion, next actions, meetings, activity", () => {
    const d = crmDashboard(demo, "tenant-nova", DEMO_NOW);
    expect(d).toMatchObject({ newLeads: 1, activeLeads: 5, opportunities: 2, customers: 2, wonValueMicros: usd(8_400) });
    expect(d.conversionRate).toBeCloseTo(2 / 8, 5);
    expect(d.estimatedSalesMicros).toBe(board.filter((column) => !["won", "lost"].includes(column.stage)).reduce((sum, column) => sum + column.expectedValueMicros, 0));
    expect(d.nextActions).toHaveLength(5);
    expect(d.nextActions.map((item) => item.dueAt)).toEqual([...d.nextActions.map((item) => item.dueAt)].sort());
    expect(d.meetings).toEqual([{ id: expect.any(String), at: t(11, 4, 15), title: "Reunión de diagnóstico con Taller Rápido", leadName: "Sofía Rey" }]);
    expect(d.recentActivity).toHaveLength(8);
    expect(d.recentActivity.map((item) => item.at)).toEqual([...d.recentActivity.map((item) => item.at)].sort().reverse());
  });
});

describe("KOE's intelligence: scores, probability, risk, expected value and time", () => {
  it("scores a lead from its stage, its own score, its audit, its contacts and the time since the last one", () => {
    const fresh = insight(handLead({ fit: 80 }), [entry("call", t(10, 24)), entry("email", t(10, 23))]);
    expect(fresh.leadScore).toBe(84); // 0.6*80 + 0.4*80 + 2 contacts * 2
    expect(fresh.opportunityScore).toBe(Math.round(STAGE_BASE.qualified + 0.25 * 84 + 0.2 * 84));
    expect(fresh.probability).toBeCloseTo(fresh.opportunityScore / 100, 2);
    expect(fresh.daysSinceTouch).toBe(1);
    const stale = insight(handLead({ fit: 80 }), [entry("call", t(10, 14))]);
    expect(stale.opportunityScore).toBeLessThan(fresh.opportunityScore); // a cold lead loses points
    expect(stale.daysSinceTouch).toBe(11);
    expect(stale.reasons.some((reason) => reason.includes("resta"))).toBe(true);
    expect(insight(handLead({ stage: "won" })).opportunityScore).toBe(100);
    expect(insight(handLead({ stage: "won" })).probability).toBe(1);
    expect(insight(handLead({ stage: "lost" })).opportunityScore).toBe(0);
    expect(insight(handLead({ stage: "lost" })).probability).toBe(0);
    expect(insight(handLead({ stage: "lost" })).nextBest).toBeNull();
  });

  it("rates the risk from days without contact, days in the stage, a weak score and overdue tasks, and says why", () => {
    const calm = insight(handLead(), [entry("call", t(10, 24))]);
    expect(calm).toMatchObject({ risk: "low", riskReasons: [] });
    const slow = insight(handLead({ stageSince: t(10, 1) }), [entry("call", t(10, 24))]);
    expect(slow.riskReasons.join()).toContain("días en «qualified»");
    expect(slow.risk).toBe("medium");
    const cold = insight(handLead({ fit: 30, stageSince: t(10, 1) }), [entry("call", t(10, 10))]);
    expect(["high", "critical"]).toContain(cold.risk);
    expect(cold.riskReasons.length).toBeGreaterThanOrEqual(3);
    expect(cold.priority === "high" || cold.priority === "critical").toBe(true);
    const overdue = analyzeLead({ lead: handLead(), timeline: [entry("call", t(10, 24))], tasks: [{ id: "tk", tenantId: "tenant-nova", leadId: "ld_x", kind: "call", title: "x", reason: "", draft: "", dueAt: t(10, 20), status: "accepted", proposedBy: "worker:nex", proposedAt: t(10, 19) }], audits: [] }, t(10, 25));
    expect(overdue.riskReasons.join()).toContain("vencida");
  });

  it("works out the expected value and the expected time to close, slower when the risk is higher", () => {
    const base = insight(handLead({ stage: "proposal", stageSince: t(10, 24) }), [entry("call", t(10, 24))]);
    expect(base.expectedValueMicros).toBe(Math.round(usd(1_000) * base.probability));
    expect(base.expectedDays).toBe(Math.max(2, STAGE_DAYS.proposal - base.daysInStage) + STAGE_DAYS.negotiation);
    expect(base.expectedCloseAt).toBe(new Date(Date.parse(t(10, 25)) + base.expectedDays * 86_400_000).toISOString());
    const risky = insight(handLead({ stage: "proposal", stageSince: t(10, 24), fit: 30 }), [entry("call", t(10, 10))]); // same stage and days in it, but nobody has written in 15 days
    expect(risky.expectedDays).toBeGreaterThan(base.expectedDays);
    expect(insight(handLead({ stage: "won" })).expectedCloseAt).toBeNull();
  });

  it("recommends the next best action with its reason: a first email, a call when it is cooling, else what the stage calls for", () => {
    expect(insight(handLead({ stage: "prospect" })).nextBest).toMatchObject({ kind: "email", reason: expect.stringContaining("primer correo") });
    const cooling = insight(handLead({ stage: "proposal" }), [entry("email", t(10, 18))]);
    expect(cooling.nextBest).toMatchObject({ kind: "call", urgency: "high", reason: "Han pasado 7 días sin contacto: llamar hoy" });
    const byStage = (stage: Stage) => insight(handLead({ stage, stageSince: t(10, 24) }), [entry("call", t(10, 24))]).nextBest?.kind;
    expect([byStage("prospect"), byStage("qualified"), byStage("meeting"), byStage("proposal"), byStage("negotiation")]).toEqual(["email", "meeting", "proposal", "followup", "call"]);
  });

  it("changes with a Business Audit: a better fit raises the scores, and the audit shows in the reasons", () => {
    const lead = handLead({ fit: 50 });
    const before = analyzeLead({ lead, timeline: [], tasks: [], audits: [] }, t(10, 16));
    const audit = { id: "ba", tenantId: "tenant-nova", leadId: "ld_x", at: t(10, 16), answers: HOT_ANSWERS, recommended: auditModules(HOT_ANSWERS), fitScore: auditFit(HOT_ANSWERS) };
    const after = analyzeLead({ lead, timeline: [], tasks: [], audits: [audit] }, t(10, 16));
    expect(after.leadScore).toBeGreaterThan(before.leadScore);
    expect(after.opportunityScore).toBeGreaterThan(before.opportunityScore);
    expect(after.auditScore).toBe(auditFit(HOT_ANSWERS));
    expect(after.reasons.join()).toContain("Business Audit");
  });

  it("recommends moving up only when the scores say so, and never to a closing stage", () => {
    const strong = insight(handLead({ stage: "qualified", fit: 90 }), [entry("call", t(10, 24))]);
    expect(advanceCheck(strong, "qualified").ok).toBe(true);
    expect(advanceCheck(insight(handLead({ stage: "qualified", fit: 30 }), [entry("call", t(10, 24))]), "qualified")).toMatchObject({ ok: false, reason: expect.stringContaining(`al menos ${ADVANCE_THRESHOLD.qualified}`) });
    expect(advanceCheck(strong, "negotiation").reason).toContain("cerrar es de una persona");
  });
});

describe("the pipeline: a Kanban with everything a card must show", () => {
  it("has the seven stages in order, and every card shows both scores, next action, value, time in stage, risk and owner", () => {
    expect(board.map((column) => column.stage)).toEqual(["prospect", "qualified", "meeting", "proposal", "negotiation", "won", "lost"]);
    const marta = card("Marta Solís");
    expect(marta).toMatchObject({ stage: "negotiation", owner: "ana", valueMicros: usd(4_800) });
    expect(marta?.leadScore).toBeGreaterThan(0);
    expect(marta?.opportunityScore).toBeGreaterThan(0);
    expect(marta?.nextAction?.kind).toBeDefined();
    expect(marta?.daysInStage).toBe(9);
    expect(marta?.risk).toBeDefined();
    expect(card("Luis Prado")).toMatchObject({ risk: "critical", priority: "critical" });
    expect(card("Pedro Gómez")?.owner).toBe(""); // NEX created it: nobody owns it yet
    const qualified = board.find((column) => column.stage === "qualified")?.cards ?? [];
    expect(qualified.map((item) => item.opportunityScore)).toEqual([...qualified.map((item) => item.opportunityScore)].sort((a, b) => b - a));
    expect(board.find((column) => column.stage === "won")?.valueMicros).toBe(usd(8_400));
  });
});

describe("one intelligence, in one place", () => {
  it("keeps the scoring rules only in koe-crm.ts, and the screens only format", () => {
    const owners = readdirSync(__dirname).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).filter((name) => /STAGE_BASE|HIGH_PROBABILITY|riskPoints|opportunityScore\s*=/.test(readFileSync(join(__dirname, name), "utf8")));
    expect(owners.sort()).toEqual(["koe-crm.ts"]);
    const dir = join(__dirname, "../../../app/(app)/platform/_components");
    const screens = readdirSync(dir).filter((name) => /^Crm.*\.tsx$/.test(name) && !name.endsWith(".test.tsx"));
    expect(screens.length).toBeGreaterThanOrEqual(3);
    for (const name of screens) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/\.reduce\(|Math\.round|opportunityScore\s*[+*-]/);
  });

  it("never reaches a model, a provider or the network from the CRM modules", () => {
    const files = readdirSync(__dirname).filter((name) => /^(crm-|koe-crm)/.test(name) && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const name of files) {
      const code = readFileSync(join(__dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, name).not.toMatch(/lib\/ai|fetch\(|XMLHttpRequest|process\.env|import\(|openai|anthropic|gemini|mistral/i);
    }
  });

  it("has no event that deletes or overwrites a record", () => {
    const events = readFileSync(join(__dirname, "crm-center.ts"), "utf8").match(/type: "([a-z.]+)"/g)?.map((item) => item.slice(7, -1)) ?? [];
    expect(events.length).toBeGreaterThan(14);
    expect(events.some((item) => /delete|remove|erase|overwrite|reset|clear|archive/.test(item))).toBe(false);
  });
});

describe("KOE does the analysis and the answer says how", () => {
  it("records, with every analysis, the Worker KOE chose, the model its router chose and why, and the estimated cost", () => {
    const analysis = latestAnalysis(demo, "tenant-nova", card("Marta Solís")?.leadId ?? "");
    expect(analysis).toMatchObject({ workerId: "sales", workerName: "Asistente comercial", model: { id: "m-fast-a", label: "Rápido A" }, modelReason: "Rápido A" });
    expect(analysis?.estimatedCostMicros).toBeGreaterThan(0);
    expect(analysis?.opportunityScore).toBe(card("Marta Solís")?.opportunityScore);
  });

  it("appends an analysis every time and never rewrites an earlier one", () => {
    const made = created();
    let state = touch(made.state, made.id, 2);
    const first = JSON.stringify(analysesOf(state, "tenant-nova", made.id));
    state = must(state, { ...ANA, at: t(10, 20), type: "analysis.refresh", leadId: made.id });
    const all = analysesOf(state, "tenant-nova", made.id);
    expect(all.length).toBe(JSON.parse(first).length + 1);
    expect(JSON.stringify(all.slice(0, -1))).toBe(first);
    expect(all.at(-1)?.previousOpportunityScore).toBe(all.at(-2)?.opportunityScore);
    expect(all.at(-1)?.opportunityScore).toBeLessThan(all.at(-2)?.opportunityScore ?? 0); // eighteen days later, the lead is colder
    expect(state.timeline.at(-1)).toMatchObject({ kind: "nex", actor: "worker:sales" });
  });

  it("refuses an analysis when KOE has no Worker or model, but keeps a change a person made", () => {
    const made = created();
    const noModels: KoeEnv = { workers: DEFAULT_WORKERS, models: BASE_MODELS.map((model) => ({ ...model, enabled: false })) };
    const refused = step(made.state, { ...ANA, at: t(10, 3), type: "analysis.refresh", leadId: made.id }, noModels);
    expect(refused.errorCode).toBe("noWorker");
    expect(refused.state.analyses).toHaveLength(made.state.analyses.length);
    expect(step(made.state, { ...SYSTEM, at: t(10, 3), type: "audit.record", leadId: made.id, answers: HOT_ANSWERS }, noModels).errorCode).toBe("noWorker");
    const moved = step(touch(made.state, made.id, 2), { ...ANA, at: t(10, 3), type: "stage.move", leadId: made.id, to: "qualified" }, noModels);
    expect(moved.error).toBeUndefined();
    expect(moved.state.leads[0].stage).toBe("qualified");
    expect(moved.state.audit.some((item) => item.action === "analysis.pending")).toBe(true);
  });
});

import { STARTER_WORKERS } from "./koe-registry";
const DEFAULT_WORKERS = STARTER_WORKERS;

describe("Business Audit integration", () => {
  it("is recorded by the platform only, from closed answers", () => {
    const made = created();
    const audit = (who: { tenantId: string; actor: string }, answers: unknown = HOT_ANSWERS) => step(made.state, { ...who, at: t(10, 2), type: "audit.record", leadId: made.id, answers: answers as typeof HOT_ANSWERS });
    expect(audit(ANA).errorCode).toBe("systemOnly");
    expect(audit(NEX).errorCode).toBe("systemOnly");
    expect(audit(SYSTEM, { ...HOT_ANSWERS, crm: "nope" }).errorCode).toBe("invalid");
    expect(audit(SYSTEM, null).errorCode).toBe("invalid");
    expect(audit({ tenantId: "tenant-vida", actor: "system" }).errorCode).toBe("notYours");
    expect(isAuditAnswers(HOT_ANSWERS)).toBe(true);
  });

  it("updates the opportunity score, recommendations, priority and risk, and never overwrites the history", () => {
    const made = created(newCrmState(), ANA, { fit: 50 });
    const first = must(made.state, { ...SYSTEM, at: t(10, 2), type: "audit.record", leadId: made.id, answers: COLD_ANSWERS });
    const second = must(first, { ...SYSTEM, at: t(10, 3), type: "audit.record", leadId: made.id, answers: HOT_ANSWERS });
    expect(second.audits).toHaveLength(2); // the first audit is still there
    expect(second.audits[0]).toEqual(first.audits[0]);
    expect(second.audits[1]).toMatchObject({ fitScore: auditFit(HOT_ANSWERS), recommended: auditModules(HOT_ANSWERS) });
    expect(auditFit(HOT_ANSWERS)).toBeGreaterThan(auditFit(COLD_ANSWERS));
    const all = analysesOf(second, "tenant-nova", made.id);
    expect(all.at(-1)?.trigger).toBe("audit");
    expect(all.at(-1)?.opportunityScore).toBeGreaterThan(all.at(-2)?.opportunityScore ?? 0); // the better audit raised it
    expect(second.timeline.filter((item) => item.kind === "audit")).toHaveLength(2);
    expect(second.timeline.find((item) => item.kind === "audit")?.summary).toContain("recomienda");
    expect(analysesOf(second, "tenant-nova", made.id).length).toBe(analysesOf(first, "tenant-nova", made.id).length + 1);
  });
});

describe("Constitution: NEX prepares, an authorization lets it move, a person decides", () => {
  it("lets NEX create a prospect, refresh the analysis and propose tasks (Level 1)", () => {
    const made = created(newCrmState(), NEX, { owner: undefined });
    expect(made.state.leads[0]).toMatchObject({ createdBy: "worker:nex", owner: "", stage: "prospect" });
    expect(must(made.state, { ...NEX, at: t(10, 2), type: "analysis.refresh", leadId: made.id }).analyses.length).toBeGreaterThan(0);
    const generated = must(made.state, { ...NEX, at: t(10, 2), type: "task.generate", leadId: made.id });
    expect(tasksOf(generated, "tenant-nova")[0]).toMatchObject({ status: "proposed", proposedBy: "worker:nex", kind: "email" });
    expect(must(made.state, { ...NEX, at: t(10, 2), type: "task.propose", leadId: made.id, kind: "call", title: "Llamar a Ana" }).tasks[0].status).toBe("proposed");
    expect([ACTION_LEVELS["crm.draft"], ACTION_LEVELS["crm.task"], ACTION_LEVELS["crm.stage.auto"], ACTION_LEVELS["crm.close"], ACTION_LEVELS["crm.convert"]]).toEqual([1, 1, 2, 3, 3]);
  });

  it("refuses NEX everything that decides: edit data, record contacts, accept or complete tasks, close, convert, schedule, authorize", () => {
    let state = created().state;
    const id = state.leads[0].id;
    state = must(state, { ...NEX, at: t(10, 2), type: "task.generate", leadId: id });
    const taskId = state.tasks[0].id;
    const events: CrmEvent[] = [
      { ...NEX, at: t(10, 3), type: "lead.update", leadId: id, patch: { name: "Otro" } },
      { ...NEX, at: t(10, 3), type: "interaction.record", subject: { kind: "lead", id }, kind: "call", summary: "x" },
      { ...NEX, at: t(10, 3), type: "task.accept", taskId }, { ...NEX, at: t(10, 3), type: "task.complete", taskId }, { ...NEX, at: t(10, 3), type: "task.dismiss", taskId },
      { ...NEX, at: t(10, 3), type: "stage.move", leadId: id, to: "won" }, { ...NEX, at: t(10, 3), type: "stage.move", leadId: id, to: "lost", note: "x" },
      { ...NEX, at: t(10, 3), type: "customer.convert", leadId: id }, { ...NEX, at: t(10, 3), type: "meeting.schedule", leadId: id, scheduledFor: t(11, 1), title: "x" },
      { ...NEX, at: t(10, 3), type: "authorization.grant" }, { ...NEX, at: t(10, 3), type: "authorization.revoke", grantId: "gr_00001" },
      { ...NEX, at: t(10, 3), type: "contact.add", customerId: "cu_1", name: "x", role: "y" },
    ];
    for (const event of events) expect(step(state, event).errorCode, event.type).toBe("personRequired");
    expect(step(state, { tenantId: "tenant-nova", actor: "system", at: t(10, 3), type: "lead.create", input: input() }).errorCode).toBe("personRequired"); // the platform does not author prospects
  });

  it("moves a stage automatically only with a vigente authorization, one step forward, and only when KOE's rules agree", () => {
    const base = created(newCrmState(), ANA, { fit: 90 });
    const warm = touch(base.state, base.id, 2);
    const auto = (state: CrmState, to: Stage, day = 3) => step(state, { ...NEX, at: t(10, day), type: "stage.move", leadId: base.id, to });
    expect(auto(warm, "qualified").errorCode).toBe("needsAuthorization"); // no authorization yet
    const granted = must(warm, GRANT);
    const moved = auto(granted, "qualified");
    expect(moved.error).toBeUndefined();
    expect(moved.state.leads[0]).toMatchObject({ stage: "qualified" });
    expect(moved.state.leads[0].stageHistory.at(-1)).toMatchObject({ from: "prospect", to: "qualified", by: "worker:nex", mode: "auto" });
    expect(moved.state.timeline.some((item) => item.summary.includes("con autorización vigente"))).toBe(true);
    expect(auto(granted, "meeting").errorCode).toBe("personRequired"); // two steps is not allowed
    expect(auto(granted, "won").errorCode).toBe("personRequired"); // never to a closing stage
    expect(auto(moved.state, "prospect").errorCode).toBe("personRequired"); // never backwards
    const weak = must(touch(created(newCrmState(), ANA, { fit: 20 }).state, "ld_00001", 2), GRANT);
    expect(step(weak, { ...NEX, at: t(10, 3), type: "stage.move", leadId: "ld_00001", to: "qualified" })).toMatchObject({ errorCode: "notEligible" });
    expect(ADVANCE_THRESHOLD.prospect).toBe(60);
  });

  it("applies the authorization's limits: per day, expiry and revocation", () => {
    const limited = must(newCrmState(), { ...ANA, at: t(10, 1), type: "authorization.grant", maxPerDay: 1, expiresAt: t(10, 20) });
    let state = limited;
    const ids: string[] = [];
    for (const name of ["Uno", "Dos"]) { const made = created(state, ANA, { name, fit: 95 }, 2); state = touch(made.state, made.id, 2); ids.push(made.id); }
    const first = step(state, { ...NEX, at: t(10, 3), type: "stage.move", leadId: ids[0], to: "qualified" });
    expect(first.error).toBeUndefined();
    expect(step(first.state, { ...NEX, at: t(10, 3), type: "stage.move", leadId: ids[1], to: "qualified" }).errorCode).toBe("needsAuthorization"); // one use today
    expect(step(first.state, { ...NEX, at: t(10, 4), type: "stage.move", leadId: ids[1], to: "qualified" }).error).toBeUndefined(); // a new day
    expect(step(state, { ...NEX, at: t(10, 21), type: "stage.move", leadId: ids[0], to: "qualified" }).errorCode).toBe("needsAuthorization"); // expired
    const revoked = must(state, { ...PABLO, at: t(10, 2), type: "authorization.revoke", grantId: grantsOf(state, "tenant-nova")[0].id });
    expect(step(revoked, { ...NEX, at: t(10, 3), type: "stage.move", leadId: ids[0], to: "qualified" }).errorCode).toBe("needsAuthorization");
    expect(step(state, { ...LUCIA, at: t(10, 2), type: "authorization.revoke", grantId: grantsOf(state, "tenant-nova")[0].id }).errorCode).toBe("notYours");
    expect(step(newCrmState(), { ...ANA, at: t(10, 1), type: "authorization.grant", maxPerDay: 0 }).errorCode).toBe("invalid");
    expect(step(newCrmState(), { ...ANA, at: t(10, 1), type: "authorization.grant", expiresAt: t(9, 1) }).errorCode).toBe("invalid");
  });

  it("never closes a sale or converts a customer without a person, and a person decides each", () => {
    let state = touch(created().state, "ld_00001", 2);
    state = move(state, "ld_00001", "qualified", 3);
    expect(step(state, { ...ANA, at: t(10, 4), type: "customer.convert", leadId: "ld_00001" }).errorCode).toBe("notWon"); // only a won deal
    expect(step(state, { ...ANA, at: t(10, 4), type: "stage.move", leadId: "ld_00001", to: "lost" }).errorCode).toBe("invalid"); // a reason is required
    const lost = must(state, { ...ANA, at: t(10, 4), type: "stage.move", leadId: "ld_00001", to: "lost", note: "Sin presupuesto" });
    expect(lost.leads[0].stage).toBe("lost");
    expect(lost.leads[0].stageHistory.at(-1)).toMatchObject({ to: "lost", note: "Sin presupuesto", mode: "person" });
    expect(must(lost, { ...ANA, at: t(10, 5), type: "stage.move", leadId: "ld_00001", to: "meeting" }).leads[0].stage).toBe("meeting"); // a person may reopen a lost deal
    const won = must(state, { ...ANA, at: t(10, 4), type: "stage.move", leadId: "ld_00001", to: "won" });
    expect(step(won, { ...ANA, at: t(10, 5), type: "stage.move", leadId: "ld_00001", to: "qualified" }).errorCode).toBe("closedDeal"); // a won deal is final
    const converted = must(won, { ...PABLO, at: t(10, 5), type: "customer.convert", leadId: "ld_00001" });
    expect(customersOf(converted, "tenant-nova")[0]).toMatchObject({ leadId: "ld_00001", convertedBy: "pablo", company: "Empresa Prueba" });
    expect(converted.leads[0].stage).toBe("won"); // the prospect's own history stays
    expect(step(converted, { ...PABLO, at: t(10, 6), type: "customer.convert", leadId: "ld_00001" }).errorCode).toBe("alreadyConverted");
    expect(step(state, { ...ANA, at: t(10, 4), type: "stage.move", leadId: "ld_00001", to: "qualified" }).errorCode).toBe("invalidMove");
  });

  it("keeps every stage change, every contact and every earlier value: nothing is overwritten", () => {
    let state = created().state;
    const id = state.leads[0].id;
    state = touch(state, id, 2);
    state = move(state, id, "qualified", 3);
    state = must(state, { ...ANA, at: t(10, 4), type: "lead.update", leadId: id, patch: { name: "Ana Pérez", estimatedValueMicros: usd(2_000) } });
    expect(state.leads[0]).toMatchObject({ name: "Ana Pérez", estimatedValueMicros: usd(2_000) });
    expect(state.audit.at(-1)?.detail).toContain("name: Ana Prueba → Ana Pérez");
    expect(state.audit.at(-1)?.detail).toContain(`estimatedValueMicros: ${usd(1_000)} → ${usd(2_000)}`);
    expect(state.leads[0].stageHistory.map((item) => item.to)).toEqual(["prospect", "qualified"]);
    expect(state.timeline.filter((item) => item.kind === "call")).toHaveLength(1);
  });
});

describe("Smart Tasks: NEX proposes, a person decides, nothing is ever executed", () => {
  it("proposes at most three tasks with drafts and a reason, and does not repeat what is already waiting", () => {
    const made = created(newCrmState(), ANA, { fit: 80 });
    let state = touch(made.state, made.id, 2);
    state = move(state, made.id, "qualified", 3);
    const generated = must(state, { ...NEX, at: t(10, 4), type: "task.generate", leadId: made.id });
    const open = tasksOf(generated, "tenant-nova");
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open.length).toBeLessThanOrEqual(3);
    expect(open.every((task) => task.status === "proposed" && task.draft.length > 20 && task.reason.length > 5 && task.title.includes("Ana Prueba"))).toBe(true);
    expect(must(generated, { ...NEX, at: t(10, 4), type: "task.generate", leadId: made.id }).tasks).toHaveLength(open.length); // no repeats
    expect(generated.timeline.at(-1)?.summary).toContain("nada se ejecutó");
    const lead = generated.leads[0];
    const context = contextOf(generated, lead);
    expect(proposalsFor(context, analyzeLead(context, t(10, 4)))).toEqual([]); // everything proposable is already waiting
  });

  it("prepares a draft for each kind of task: email, WhatsApp, meeting, proposal, follow-up and call", () => {
    const lead = handLead({ name: "Mario Solís", company: "Casa Solís" });
    const hint = insight(lead, [entry("call", t(10, 24))]);
    expect(draftFor("email", lead, hint)).toContain("Hola Mario");
    expect(draftFor("whatsapp", lead, hint)).toContain("Casa Solís");
    expect(draftFor("meeting", lead, hint)).toContain("30 minutos");
    expect(draftFor("proposal", lead, hint)).toContain("1 000 USD".replace(" ", "")) ;
    expect(draftFor("followup", lead, hint)).toContain("propuesta");
    expect(draftFor("call", lead, hint)).toContain("Puntos para la llamada");
  });

  it("lets only a person accept, complete or dismiss a proposal, once", () => {
    const made = created();
    let state = must(made.state, { ...NEX, at: t(10, 2), type: "task.generate", leadId: made.id });
    const id = state.tasks[0].id;
    const accepted = must(state, { ...ANA, at: t(10, 3), type: "task.accept", taskId: id });
    expect(accepted.tasks[0]).toMatchObject({ status: "accepted", decidedBy: "ana" });
    expect(step(accepted, { ...ANA, at: t(10, 3), type: "task.accept", taskId: id }).errorCode).toBe("taskClosed");
    const done = must(accepted, { ...ANA, at: t(10, 4), type: "task.complete", taskId: id, note: "Se envió" });
    expect(done.tasks[0].status).toBe("done");
    expect(done.timeline.at(-1)).toMatchObject({ kind: "note", actor: "ana" });
    expect(step(done, { ...ANA, at: t(10, 5), type: "task.dismiss", taskId: id }).errorCode).toBe("taskClosed");
    expect(must(state, { ...ANA, at: t(10, 3), type: "task.dismiss", taskId: id }).tasks[0].status).toBe("dismissed");
    expect(step(state, { ...LUCIA, at: t(10, 3), type: "task.accept", taskId: id }).errorCode).toBe("notYours");
    expect(step(state, { ...ANA, at: t(10, 3), type: "task.accept", taskId: "tk_99999" }).errorCode).toBe("notFound");
    state = must(state, { ...ANA, at: t(10, 3), type: "stage.move", leadId: made.id, to: "lost", note: "Sin presupuesto" });
    expect(step(state, { ...NEX, at: t(10, 4), type: "task.generate", leadId: made.id }).errorCode).toBe("closedDeal");
  });

  it("has no event that sends or executes anything", () => {
    const events = readFileSync(join(__dirname, "crm-center.ts"), "utf8").match(/type: "([a-z.]+)"/g)?.map((item) => item.slice(7, -1)) ?? [];
    expect(events.some((item) => /send|execute|run|call\./.test(item))).toBe(false);
    expect(step(created().state, { ...NEX, at: t(10, 2), type: "task.propose", leadId: "ld_00001", kind: "teleport" as never, title: "x" }).errorCode).toBe("invalid");
    expect(step(created().state, { ...NEX, at: t(10, 2), type: "task.propose", leadId: "ld_00001", kind: "call", title: " " }).errorCode).toBe("invalid");
  });
});

describe("the Smart Timeline: the whole story, oldest first", () => {
  it("shows emails, WhatsApp, calls, notes, automations, Workers, Business Audits and NEX in order", () => {
    const marta = card("Marta Solís")?.leadId ?? "";
    const story = timelineOf(demo, "tenant-nova", { kind: "lead", id: marta });
    expect(new Set(story.map((item) => item.kind))).toEqual(new Set(["email", "whatsapp", "call", "automation", "worker", "audit", "nex"]));
    expect(story.map((item) => item.at)).toEqual([...story.map((item) => item.at)].sort());
    expect(story[0].at <= (story.at(-1)?.at ?? "")).toBe(true);
    expect(story.some((item) => item.kind === "nex" && item.summary.includes("movió la etapa"))).toBe(true);
    expect(timelineOf(demo, "tenant-nova", { kind: "lead", id: card("Sofía Rey")?.leadId ?? "" }).some((item) => item.kind === "meeting")).toBe(true);
  });

  it("is written by who did it: people record their contacts, the platform reports automations and Workers", () => {
    const made = created();
    const id = made.id;
    const subject = { kind: "lead" as const, id };
    expect(step(made.state, { ...SYSTEM, at: t(10, 2), type: "interaction.record", subject, kind: "call", summary: "x" }).errorCode).toBe("personRequired");
    expect(step(made.state, { ...ANA, at: t(10, 2), type: "timeline.record", subject, kind: "automation", summary: "x" }).errorCode).toBe("systemOnly");
    expect(step(made.state, { ...ANA, at: t(10, 2), type: "interaction.record", subject, kind: "call", summary: " " }).errorCode).toBe("invalid");
    expect(step(made.state, { ...ANA, at: t(10, 2), type: "interaction.record", subject, kind: "call", summary: "x".repeat(301) }).errorCode).toBe("invalid");
    const recorded = must(made.state, { ...SYSTEM, at: t(10, 2), type: "timeline.record", subject, kind: "worker", summary: "El Worker calificó al prospecto", ref: "sales" });
    expect(recorded.timeline.at(-1)).toMatchObject({ kind: "worker", actor: "system", ref: "sales" });
    expect(step(made.state, { ...LUCIA, at: t(10, 2), type: "interaction.record", subject, kind: "call", summary: "x" }).errorCode).toBe("notYours");
    expect(step(made.state, { ...ANA, at: t(10, 2), type: "interaction.record", subject: { kind: "lead", id: "ld_99999" }, kind: "call", summary: "x" }).errorCode).toBe("notFound");
  });
});

describe("Customer 360", () => {
  const verde = customersOf(demo, "tenant-nova").find((item) => item.company === "Studio Verde");
  const view = customer360(demo, "tenant-nova", verde?.id ?? "", DEMO_NOW);

  it("brings together the company, contacts, pipeline, products, Academy, Marketplace, automations, Workers, payments and referrals", () => {
    expect(view?.company).toBe("Studio Verde");
    expect(view?.contacts.map((item) => item.name)).toEqual(["Elena Vargas", "Raúl Vargas"]);
    expect(view?.pipeline).toMatchObject({ stage: "won", valueMicros: usd(6_000) });
    expect(view?.pipeline?.stageHistory.map((item) => item.to)).toEqual(["prospect", "qualified", "meeting", "proposal", "negotiation", "won"]);
    expect(Object.fromEntries(Object.entries(view?.links ?? {}).map(([kind, items]) => [kind, items.length]))).toEqual({ product: 2, academy: 1, marketplace: 1, automation: 1, worker: 1, payment: 2, referral: 1 });
    expect(view?.paidMicros).toBe(usd(3_500));
    expect(view?.timeline.length).toBeGreaterThan(5);
    expect(view?.timeline.map((item) => item.at)).toEqual([...(view?.timeline.map((item) => item.at) ?? [])].sort());
    expect(customer360(demo, "tenant-nova", "cu_nadie", DEMO_NOW)).toBeNull();
  });

  it("takes links only from the platform, and a payment link is only a total", () => {
    const id = verde?.id ?? "";
    const link = (who: { tenantId: string; actor: string }, over: Partial<Extract<CrmEvent, { type: "customer.link" }>> = {}) => step(demo, { ...who, at: t(11, 1), type: "customer.link", customerId: id, kind: "product", ref: "x", label: "Otro producto", ...over });
    expect(link(ANA).errorCode).toBe("systemOnly");
    expect(link(NEX).errorCode).toBe("systemOnly");
    expect(link(SYSTEM).error).toBeUndefined();
    expect(link(SYSTEM, { kind: "product", amountMicros: 5 }).errorCode).toBe("invalid"); // an amount only on a payment
    expect(link(SYSTEM, { kind: "bank" as never }).errorCode).toBe("invalid");
    expect(link(SYSTEM, { label: " " }).errorCode).toBe("invalid");
    expect(link({ tenantId: "tenant-vida", actor: "system" }).errorCode).toBe("notYours");
    expect(JSON.stringify(view)).not.toMatch(/iban|tarjeta|card|account|cuenta|banco/i);
  });

  it("lets a person add a contact, and only a person", () => {
    const id = verde?.id ?? "";
    const add = (who: { tenantId: string; actor: string }, over = {}) => step(demo, { ...who, at: t(11, 1), type: "contact.add", customerId: id, name: "Nora Díaz", role: "Compras", email: "nora@studio.test", ...over });
    expect(add(PABLO).state.customers.find((item) => item.id === id)?.contacts).toHaveLength(3);
    expect(add(NEX).errorCode).toBe("personRequired");
    expect(add(PABLO, { email: "no-es-correo" }).errorCode).toBe("invalid");
    expect(add(PABLO, { role: " " }).errorCode).toBe("invalid");
    expect(add(LUCIA).errorCode).toBe("notYours");
  });
});

describe("the Sales Assistant says what KOE concluded", () => {
  const messages = assistantMessages(demo, "tenant-nova", DEMO_NOW);
  it("says it in plain words: high probability, call today, days that have passed, risk of losing it, a customer that can buy more", () => {
    expect(messages.map((item) => item.text)).toEqual(expect.arrayContaining(["Este prospecto tiene alta probabilidad.", "Recomiendo llamar hoy.", "Han pasado 12 días.", "Han pasado 7 días.", "Existe riesgo de perder la oportunidad.", "Este cliente puede comprar otro servicio."]));
    expect(messages.every((item) => item.reason.length > 10)).toBe(true);
    expect(messages.find((item) => item.code === "canBuyMore")).toMatchObject({ customerId: expect.any(String), reason: "Boutique Luna tiene 1 servicio(s) y pagos al día" });
    expect(messages.find((item) => item.code === "highProbability")).toBeDefined();
    expect(HIGH_PROBABILITY).toBe(0.7);
  });

  it("puts the most urgent first, and gives no message about a closed deal", () => {
    expect(messages[0].priority).toBe("critical");
    const order = ["critical", "high", "normal", "low"];
    expect(messages.map((item) => order.indexOf(item.priority))).toEqual([...messages.map((item) => order.indexOf(item.priority))].sort());
    expect(messages.some((item) => item.leadId === card("Diego Luna")?.leadId || item.leadId === card("Iván Soto")?.leadId)).toBe(false);
  });
});

describe("one company never sees or changes another's", () => {
  it("scopes every view to its company", () => {
    const vida = pipelineBoard(demo, "tenant-vida", DEMO_NOW);
    expect(vida.flatMap((column) => column.cards.map((item) => item.name)).sort()).toEqual(["Dra. Rosa Pineda", "Tomás Ruiz"]);
    expect(crmDashboard(demo, "tenant-vida", DEMO_NOW)).toMatchObject({ activeLeads: 2, customers: 0, meetings: [] });
    expect(assistantMessages(demo, "tenant-vida", DEMO_NOW).every((item) => item.reason.includes("Dra.") || item.reason.includes("Tomás") || item.reason.includes("Laboratorio") || item.reason.includes("Óptica"))).toBe(true);
    expect(leadsOf(demo, "tenant-vida")).toHaveLength(2);
    expect(JSON.stringify(crmDashboard(demo, "tenant-vida", DEMO_NOW))).not.toMatch(/Marta|Hotel Mar|Studio Verde/);
    expect(analysesOf(demo, "tenant-vida").every((item) => item.tenantId === "tenant-vida")).toBe(true);
  });

  it("is unchanged by any amount of another company's work", () => {
    const before = JSON.stringify([pipelineBoard(demo, "tenant-vida", DEMO_NOW), crmDashboard(demo, "tenant-vida", DEMO_NOW), assistantMessages(demo, "tenant-vida", DEMO_NOW)]);
    let noisy = demo;
    for (let n = 0; n < 5; n += 1) noisy = must(noisy, { ...ANA, at: t(10, 28), type: "lead.create", input: input({ name: `Ruido ${n}`, estimatedValueMicros: usd(99_999) }) });
    expect(JSON.stringify([pipelineBoard(noisy, "tenant-vida", DEMO_NOW), crmDashboard(noisy, "tenant-vida", DEMO_NOW), assistantMessages(noisy, "tenant-vida", DEMO_NOW)])).toBe(before);
  });

  it("refuses every change on another company's records", () => {
    const novaLead = card("Marta Solís")?.leadId ?? "";
    const novaTask = demo.tasks[0].id;
    const novaCustomer = customersOf(demo, "tenant-nova")[0].id;
    const events: CrmEvent[] = [
      { ...LUCIA, at: t(11, 2), type: "lead.update", leadId: novaLead, patch: { name: "x" } }, { ...LUCIA, at: t(11, 2), type: "stage.move", leadId: novaLead, to: "lost", note: "x" },
      { ...LUCIA, at: t(11, 2), type: "analysis.refresh", leadId: novaLead }, { ...LUCIA, at: t(11, 2), type: "task.generate", leadId: novaLead }, { ...LUCIA, at: t(11, 2), type: "task.propose", leadId: novaLead, kind: "call", title: "x" },
      { ...LUCIA, at: t(11, 2), type: "task.complete", taskId: novaTask }, { ...LUCIA, at: t(11, 2), type: "meeting.schedule", leadId: novaLead, scheduledFor: t(11, 9), title: "x" },
      { ...LUCIA, at: t(11, 2), type: "customer.convert", leadId: novaLead }, { ...LUCIA, at: t(11, 2), type: "contact.add", customerId: novaCustomer, name: "x", role: "y" },
      { tenantId: "tenant-vida", actor: "system", at: t(11, 2), type: "audit.record", leadId: novaLead, answers: HOT_ANSWERS },
    ];
    for (const event of events) expect(step(demo, event).errorCode, event.type).toBe("notYours");
  });
});

describe("prospects are validated", () => {
  it("names what is wrong", () => {
    expect(validateLead(input())).toEqual([]);
    expect(validateLead(input({ name: " " }))[0]).toContain("nombre");
    expect(validateLead(input({ email: "no-es-correo" }))).toContain("correo");
    expect(validateLead(input({ phone: "12" }))).toContain("teléfono");
    expect(validateLead(input({ source: "" }))[0]).toContain("origen");
    expect(validateLead(input({ estimatedValueMicros: -1 }))).toContain("valor estimado");
    expect(validateLead(input({ fit: 101 }))).toContain("ajuste de 0 a 100");
    expect(validateLead(input({ fit: 50.5 }))).toContain("ajuste de 0 a 100");
    expect(step(newCrmState(), { ...ANA, at: t(10, 1), type: "lead.create", input: input({ name: "" }) }).errorCode).toBe("invalid");
    expect(step(created().state, { ...ANA, at: t(10, 2), type: "lead.update", leadId: "ld_00001", patch: { fit: 500 } }).errorCode).toBe("invalid");
  });
});

describe("the future is declared and not built", () => {
  it("lists sales prediction, forecast, churn detection, cross selling, up selling, renewals and churn prediction, all through KOE and unbuilt", () => {
    expect(FUTURE_CRM.map((item) => item.id)).toEqual(["salesPrediction", "forecast", "churnDetection", "crossSelling", "upSelling", "renewals", "churnPrediction"]);
    for (const item of FUTURE_CRM) expect(item).toMatchObject({ status: "notBuilt", runsThrough: "KOE", readsFrom: "KOE CRM records" });
    const code = ["koe-crm.ts", "crm-center.ts"].map((name) => readFileSync(join(__dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n");
    expect(code).not.toMatch(/function\s+(predict|forecast|detectChurn|crossSell|upSell|renew)/i);
  });
});

describe("language", () => {
  it("has a message for every error code and Spanish labels", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b" }), code).not.toMatch(/\{\w+\}/);
    expect(label("stage", "negotiation")).toBe("Negociación");
    expect(label("risk", "critical")).toBe("Crítico");
    expect(label("taskKind", "proposal")).toBe("Enviar propuesta");
    expect(label("tabs", "customer")).toBe("Cliente 360");
    expect(message("invalidMove", { from: "won", to: "lost" })).toBe("No se puede pasar de «won» a «lost».");
  });
});
